import { BN, Provider } from "@project-serum/anchor";
import NodeWallet from "@project-serum/anchor/dist/cjs/nodewallet";
import { sendAndConfirmTransaction, Keypair, Connection, PublicKey } from "@solana/web3.js";
import base58 from "bs58";

import { DexProgram, Side } from "@dradex/sdk";

// ENTER YOUR SECRET KEY HERE
const SECRET_KEY = process.env.SECRET_KEY || "<your secret key>";
const KEYPAIR = Keypair.fromSecretKey(base58.decode(SECRET_KEY));

// GMT-USDC
const MARKET_ID = new PublicKey("4v57hiqDBBpmpBU3ta3vmrgE4d8AWdWHyykLzzcfukJp");

async function main() {
  const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const provider = new Provider(connection, new NodeWallet(KEYPAIR), { commitment: "confirmed" });
  const dex = new DexProgram({ provider });

  // fetch market
  const market = await dex.getMarket(MARKET_ID);
  await dex.loadMarket(market);

  // send a market order to buy 0.01 GMT
  // associated token accounts for both tokens must be available
  const tx = await dex.createOrder(market, {
    amount: new BN(10_000_000),
    clientOrderId: new BN(0),
    limitPrice: new BN(0),
    limitTotal: null,
    minAmountOut: new BN(0),
    orderType: 0,
    side: Side.BID,
  });
  const txId = await sendAndConfirmTransaction(connection, tx, [KEYPAIR], { skipPreflight: true });
  console.log("txId:", txId);
}

main();
