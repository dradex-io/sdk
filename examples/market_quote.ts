import { NATIVE_MINT } from "@solana/spl-token";
import { Connection, PublicKey, AccountInfo } from "@solana/web3.js";
import JSBI from "jsbi";

import { DexMarket, SwapMode } from "../src";

const MARKET_ID = new PublicKey("CJept8TLyG9r2GMhttqR98zohVq274XCMiy5oxjTKKBt");
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

async function main() {
  const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

  // fetch market
  const marketAccountInfo = await connection.getAccountInfo(MARKET_ID);
  const market = new DexMarket(MARKET_ID, marketAccountInfo!);

  // update data
  const accountKeys = market.getAccountsForUpdate();
  const accounts = await connection.getMultipleAccountsInfo(accountKeys);
  const accountMap = toAccountInfoMap(accountKeys, accounts as (AccountInfo<Buffer> | null)[]);
  market.update(accountMap);

  // get quotes
  const quotes = [
    [
      "BUY 1 USD of SOL",
      market.getQuote({
        amount: JSBI.BigInt(1000_000),
        sourceMint: USDC_MINT,
        destinationMint: NATIVE_MINT,
        swapMode: SwapMode.ExactIn,
      }),
    ],
    [
      "SELL 1 SOL",
      market.getQuote({
        amount: JSBI.BigInt(1000_000_000),
        sourceMint: NATIVE_MINT,
        destinationMint: USDC_MINT,
        swapMode: SwapMode.ExactIn,
      }),
    ],
    [
      "SELL 1 USD of SOL",
      market.getQuote({
        amount: JSBI.BigInt(1000_000),
        sourceMint: NATIVE_MINT,
        destinationMint: USDC_MINT,
        swapMode: SwapMode.ExactOut,
      }),
    ],
    [
      "BUY 1 SOL",
      market.getQuote({
        amount: JSBI.BigInt(1000_000_000),
        sourceMint: USDC_MINT,
        destinationMint: NATIVE_MINT,
        swapMode: SwapMode.ExactOut,
      }),
    ],
    [
      "BUY a very small amount of SOL",
      market.getQuote({
        amount: JSBI.BigInt(100),
        sourceMint: USDC_MINT,
        destinationMint: NATIVE_MINT,
        swapMode: SwapMode.ExactIn,
      }),
    ],
    [
      "SELL a very small amount of SOL",
      market.getQuote({
        amount: JSBI.BigInt(100),
        sourceMint: NATIVE_MINT,
        destinationMint: USDC_MINT,
        swapMode: SwapMode.ExactIn,
      }),
    ],
  ];
  quotes.forEach(([message, quote]) => {
    console.log(message, JSON.stringify(quote, undefined, 2), "\n");
  });
}

function toAccountInfoMap(keys: PublicKey[], accounts: (AccountInfo<Buffer> | null)[]) {
  const accountMap = new Map<string, AccountInfo<Buffer>>();
  accounts.forEach((account, index) => account && accountMap.set(keys[index].toString(), account));
  return accountMap;
}

main();
