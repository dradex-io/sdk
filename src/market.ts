import { Mint, unpackMint } from "@solana/spl-token";
import { Order, OrderBook } from "@dradex/idl";
import { AccountInfo, PublicKey } from "@solana/web3.js";

import { dexCoder, MarketState } from "./core";
import { Quote, QuoteCalculator, QuoteParams } from "./quote";
export type AccountInfoMap = Map<string, AccountInfo<Buffer> | null>;

interface Amm {
  reserveTokenMints: PublicKey[];
  getAccountsForUpdate(): PublicKey[];
  update(accountInfoMap: AccountInfoMap): void;
  getQuote(quoteParams: QuoteParams): Quote;
}

export class DexMarket implements Amm {
  address: PublicKey;
  id: string;
  reserveTokenMints: PublicKey[];
  state: MarketState;
  orderBookState: {
    bids: Order[];
    asks: Order[];
  };
  mintInfos: Mint[];
  quoteCalculator: QuoteCalculator;

  constructor(address: PublicKey, accountInfo: AccountInfo<Buffer>) {
    this.address = address;
    this.id = address.toString();
    this.decodeMarketState(accountInfo);
    this.reserveTokenMints = [this.state.t0, this.state.t1];
  }

  decodeMarketState(accountInfo: AccountInfo<Buffer>) {
    this.state = dexCoder.accounts.decode("market", accountInfo.data);
  }

  getAccountsForUpdate(): PublicKey[] {
    return [this.address, ...this.reserveTokenMints, this.state.orderBook.bids, this.state.orderBook.asks];
  }

  update(accountInfoMap: AccountInfoMap) {
    const market = accountInfoMap.get(this.id);
    const bids = accountInfoMap.get(this.state.orderBook.bids.toString());
    const asks = accountInfoMap.get(this.state.orderBook.asks.toString());
    const mints = this.reserveTokenMints.map((mint) => accountInfoMap.get(mint.toString()));
    if (!market || !bids || !asks || mints.find((mint) => !mint)) {
      throw new Error("one of the required accounts is missing");
    }
    this.decodeMarketState(market);
    this.mintInfos = this.reserveTokenMints.map((mint, index) => unpackMint(mint, mints[index]!));
    this.orderBookState = {
      bids: OrderBook.decode(bids.data).items,
      asks: OrderBook.decode(asks.data).items,
    };
    this.quoteCalculator = new QuoteCalculator(this.state, this.orderBookState, this.mintInfos);
  }

  getQuote(quoteParams: QuoteParams): Quote {
    return this.quoteCalculator.getQuote(quoteParams);
  }

  getAccounts() {
    return {
      pair: this.state.pair,
      market: this.address,
      t0Vault: this.state.t0Vault,
      t1Vault: this.state.t1Vault,
      bids: this.state.orderBook.bids,
      asks: this.state.orderBook.asks,
      eventQueue: this.state.eventQueue,
    };
  }
}
