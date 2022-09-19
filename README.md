# Dradex SDK
> Note: This is an alpha release and in active development. Function names and signatures are subject to change.

## What is Dradex
[Dradex](https://dradex.io) is a unified Order Book & AMM exchange, where an AMM liquidity pool is seamlessly integrated with an order book.


## Examples

### Get market quotes
```js
import { NATIVE_MINT } from "@solana/spl-token";
import { Connection, PublicKey, AccountInfo } from "@solana/web3.js";
import JSBI from "jsbi";
import { DexMarket, SwapMode } from "@dradex/sdk";

const MARKET_ID = new PublicKey("CJept8TLyG9r2GMhttqR98zohVq274XCMiy5oxjTKKBt");
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

async function main() {
  const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

  // create market
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
```

### Create order

```js
import { BN, Provider } from "@project-serum/anchor";
import NodeWallet from "@project-serum/anchor/dist/cjs/nodewallet";
import { Keypair, Connection, PublicKey } from "@solana/web3.js";
import base58 from "bs58";

import { DexProgram, Side } from "@dradex/sdk";

// ENTER YOUR SECRET KEY HERE
const SECRET_KEY = process.env.SECRET_KEY || "<your secret key>";
const KEYPAIR = Keypair.fromSecretKey(base58.decode(SECRET_KEY));

// GMT-USDC
const MARKET_ID = new PublicKey("4v57hiqDBBpmpBU3ta3vmrgE4d8AWdWHyykLzzcfukJp");

async function main() {
  const connection = new Connection(
    "https://api.mainnet-beta.solana.com",
    "confirmed"
  );
  const provider = new Provider(connection, new NodeWallet(KEYPAIR), {
    commitment: "confirmed",
  });
  const dex = new DexProgram({ provider });
  const publicKey = provider.wallet.publicKey;

  // fetch market
  const market = await dex.getMarket(MARKET_ID);
  await dex.loadMarket(market);

  // ensure that the MarketUser & DexUser exists
  const dexUserAddress = await dex.getDexUserAddress(publicKey);
  const marketUserAddress = await dex.getMarketUserAddress(
    market.address,
    publicKey
  );
  const [dexUser, marketUser] = await connection.getMultipleAccountsInfo([
    dexUserAddress,
    marketUserAddress,
  ]);
  const ix = dex.createInstructionSet([]);
  if (!dexUser) {
    ix.add(await dex.createDexUser(publicKey));
  }
  if (!marketUser) {
    ix.add(await dex.createMarketUser(market, publicKey));
  }

  // send a market order to buy 0.01 GMT
  // associated token accounts for both tokens must be available
  ix.add(
    await dex.createOrder(market, {
      amount: new BN(10_000_000),
      clientOrderId: new BN(0),
      limitPrice: new BN(0),
      limitTotal: null,
      minAmountOut: new BN(0),
      orderType: 0,
      side: Side.BID,
    })
  );
  const txId = await ix.exec({ skipPreflight: true });
  console.log("txId:", txId);
}

main();
```