import {
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_CLOCK_PUBKEY,
  SystemProgram,
  AccountInfo,
  AccountMeta,
  TransactionInstruction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import { Address, Program, Provider, translateAddress } from "@project-serum/anchor";
import { Dex, DexIDL, dexIdl, loggerIdl } from "@dradex/idl";
import { DexMarket } from "./market";
import { InstructionSet, OrderInput } from "./core";

export interface DexMetadata {
  address: Address;
  master: [Address, number];
}

export interface MarketOperationAccountsInput {
  marketUser?: PublicKey;
  dexUser?: PublicKey;
  t0User?: PublicKey;
  t1User?: PublicKey;
}

export class DexProgram extends Program<Dex> {
  loggerProgramId: PublicKey;
  systemAccounts: {
    signer: PublicKey;
    master: PublicKey;
    rent: PublicKey;
    clock: PublicKey;
    systemProgram: PublicKey;
    tokenProgram: PublicKey;
    logger: PublicKey;
  };
  bumps: {
    master: number;
  };

  constructor(
    options: {
      provider?: Provider;
      loggerProgramId?: Address;
      dexMetadata?: DexMetadata;
    } = {},
  ) {
    const dexMetadata = options.dexMetadata ?? (dexIdl.metadata as DexMetadata);
    super(DexIDL, dexMetadata.address, options.provider);
    this.loggerProgramId = translateAddress(options.loggerProgramId ?? loggerIdl.metadata.address);
    this.loadDexMetadata(dexMetadata);
  }

  loadDexMetadata(dexMetadata: DexMetadata) {
    const [masterAddress, masterBump] = dexMetadata.master;
    this.systemAccounts = {
      signer: this.provider.wallet.publicKey,
      master: translateAddress(masterAddress),
      rent: SYSVAR_RENT_PUBKEY,
      clock: SYSVAR_CLOCK_PUBKEY,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      logger: this.loggerProgramId,
    };
    this.bumps = {
      master: masterBump,
    };
  }

  get connection() {
    return this.provider.connection;
  }

  get signer() {
    return this.systemAccounts.signer;
  }

  createInstructionSet(instructions: TransactionInstruction[]) {
    return new InstructionSet(instructions, this.provider);
  }

  async getMarket(address: PublicKey): Promise<DexMarket> {
    const marketAccountInfo = await this.connection.getAccountInfo(address);
    if (!marketAccountInfo) {
      throw new Error(`market ${address} not found`);
    }
    return new DexMarket(address, marketAccountInfo);
  }

  async loadMarket(market: DexMarket) {
    const accountKeys = market.getAccountsForUpdate();
    const accounts = await this.connection.getMultipleAccountsInfo(accountKeys);
    const accountMap = this.toAccountInfoMap(accountKeys, accounts as (AccountInfo<Buffer> | null)[]);
    market.update(accountMap);
  }

  private toAccountInfoMap(keys: PublicKey[], accounts: (AccountInfo<Buffer> | null)[]) {
    const accountMap = new Map<string, AccountInfo<Buffer>>();
    accounts.forEach((account, index) => account && accountMap.set(keys[index].toString(), account));
    return accountMap;
  }

  async findProgramAddress(seeds: Buffer[], programId?: PublicKey) {
    return await PublicKey.findProgramAddress(seeds, programId ?? this.programId);
  }

  async getProgramAddress(seeds: Buffer[]) {
    return (await this.findProgramAddress(seeds))[0];
  }

  async getMarketUserAddress(market: PublicKey, user?: PublicKey) {
    return await this.getProgramAddress([Buffer.from("market_user_v2"), market.toBuffer(), (user ?? this.signer).toBuffer()]);
  }

  async getDexUserAddress(user?: PublicKey) {
    return await this.getProgramAddress([Buffer.from("dex_user"), (user ?? this.signer).toBuffer()]);
  }

  async createOrder(
    market: DexMarket,
    input: OrderInput,
    options: {
      accounts?: MarketOperationAccountsInput;
      remainingAccounts?: AccountMeta[];
    } = {},
  ) {
    const signer = this.systemAccounts.signer;
    const accounts = {
      ...this.systemAccounts,
      ...market.getAccounts(),
      t0User: options.accounts?.t0User ?? (await getAssociatedTokenAddress(market.state.t0, signer)),
      t1User: options.accounts?.t1User ?? (await getAssociatedTokenAddress(market.state.t1, signer)),
      marketUser: options.accounts?.marketUser ?? (await this.getMarketUserAddress(market.address, signer)),
      dexUser: options.accounts?.dexUser ?? (await this.getDexUserAddress(signer)),
    };
    return this.createInstructionSet([
      this.instruction.createOrder(input, {
        accounts,
        remainingAccounts: options.remainingAccounts || undefined,
      }),
    ]);
  }

  async createDexUser(user?: PublicKey) {
    return this.createInstructionSet([
      this.instruction.createDexUser(null, {
        accounts: {
          ...this.systemAccounts,
          signer: user ?? this.signer,
          dexUser: await this.getDexUserAddress(user),
        },
      }),
    ]);
  }

  async createMarketUser(market: DexMarket, user?: PublicKey) {
    return this.createInstructionSet([
      this.instruction.createMarketUser({
        accounts: {
          ...this.systemAccounts,
          ...market.getAccounts(),
          signer: user ?? this.signer,
          marketUser: await this.getMarketUserAddress(market.address, user),
        },
      }),
    ]);
  }
}
