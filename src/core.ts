import { PublicKey, TransactionInstruction, Transaction, ConfirmOptions, Signer } from "@solana/web3.js";
import { BN, BorshCoder, IdlAccounts, IdlTypes, Provider } from "@project-serum/anchor";
import { Dex, DexIDL } from "@dradex/idl";

export const dexCoder = new BorshCoder(DexIDL);

export interface MarketStateOrderbook {
  bids: PublicKey;
  asks: PublicKey;
}

export interface MarketStateConfig {
  t0LotSize: BN;
  t1LotSize: BN;
  feeRates: {
    maker: BN;
    taker: BN;
  };
}

export const FEE_BPS_BASE = 10000;

export enum Side {
  BID = 0,
  ASK = 1,
}

export interface MarketFormatting {
  lotSize: number;
  tickSize: number;
  quoteSize: number;
  sizeDecimals: number;
  priceDecimals: number;
  quoteDecimals: number;
}

export type DexAccounts = IdlAccounts<Dex>;

export type MarketState = Omit<Omit<DexAccounts["market"], "orderBook">, "config"> & {
  orderBook: MarketStateOrderbook;
  config: MarketStateConfig;
};

export type OrderInput = IdlTypes<Dex>["OrderInput"];

export class InstructionSet {
  constructor(public instructions: TransactionInstruction[], private provider?: Provider) {}

  tx() {
    return new Transaction().add(...this.instructions);
  }

  add(...items: (TransactionInstruction | Transaction | InstructionSet)[]) {
    items.forEach((item) => {
      if (item instanceof TransactionInstruction) {
        this.instructions.push(item);
      } else {
        this.instructions.push(...item.instructions);
      }
    });
  }

  instruction() {
    if (this.instructions.length == 0) {
      throw new Error("no instruction available");
    }
    return this.instructions[0];
  }

  exec({ signers, ...options }: ConfirmOptions & { signers?: (Signer | undefined)[] } = {}) {
    if (!this.provider) {
      throw new Error("provider not available");
    }
    return this.provider.send(this.tx(), signers, options);
  }
}
