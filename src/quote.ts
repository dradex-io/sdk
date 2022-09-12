import { Order, OrderBook } from "@dradex/idl";
import { BN } from "@project-serum/anchor";
import { Mint } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import Decimal from "decimal.js-light";
import JSBI from "jsbi";

import { FEE_BPS_BASE, MarketFormatting, MarketState, Side } from "./core";

export enum SwapMode {
  ExactIn = "ExactIn",
  ExactOut = "ExactOut",
}

export type TokenMintAddress = string;

export interface QuoteParams {
  sourceMint: PublicKey;
  destinationMint: PublicKey;
  amount: JSBI;
  swapMode: SwapMode;
}

export interface Quote {
  notEnoughLiquidity: boolean;
  minInAmount?: JSBI;
  minOutAmount?: JSBI;
  inAmount: JSBI;
  outAmount: JSBI;
  feeAmount: JSBI;
  feeMint: TokenMintAddress;
  feePct: number;
  priceImpactPct: number;
}

export interface OrderQuoteResult {
  lpPrice: number;
  unitPrice: number;
  filled: number;
  cost: number;
  lpFilled: number;
  lpCost: number;
  orderFilled: number;
  orderCost: number;
  lpUnitPrice: number;
  orderUnitPrice: number;
  quantity: number;
  remaining: number;
  remainingTotal: number;
  computeSteps: number;
  output: {
    grossAmount: number;
    feeAmount: number;
    feePct: number;
  };
}

export class ParsedOrder {
  price: number;
  quantity: number;
}

export class QuoteCalculator {
  private formatting: MarketFormatting;
  private pool: number[];
  private orders: { bids: ParsedOrder[]; asks: ParsedOrder[] };
  private feeRates: { maker: number; taker: number };
  private basePrices: [number, number];

  constructor(public market: MarketState, public orderBook: { bids: Order[]; asks: Order[] }, public tokens: Mint[]) {
    this.formatting = this.getMarketFormatting(
      this.market.config.t0LotSize.toNumber(),
      this.market.config.t1LotSize.toNumber(),
      this.tokens[0].decimals,
      this.tokens[1].decimals,
    );
    this.pool = this.market.pool.map((poolAmount, i) => this.toUiAmount(poolAmount, this.tokens[i]));
    this.orders = {
      bids: orderBook.bids.map(this.parseOrder),
      asks: orderBook.asks.map(this.parseOrder),
    };
    this.feeRates = {
      maker: this.market.config.feeRates.maker.toNumber(),
      taker: this.market.config.feeRates.taker.toNumber(),
    };
    this.basePrices = [this.evaluateOrder(Side.BID, 0).unitPrice, this.evaluateOrder(Side.ASK, 0).unitPrice];
  }

  private getMarketFormatting(lot0: number, lot1: number, decimals0: number, decimals1: number): MarketFormatting {
    const lotSize = 10 ** -decimals0 * lot0;
    const quoteSize = 10 ** -decimals1 * lot1;
    const tickSize = lot1 / (lotSize * 10 ** decimals1);
    const sizeDecimals = Math.max(Math.floor(-Math.log10(lotSize)), 0);
    const priceDecimals = Math.max(Math.floor(-Math.log10(tickSize)), 0);
    const quoteDecimals = priceDecimals;
    return {
      lotSize,
      tickSize,
      quoteSize,
      sizeDecimals,
      priceDecimals,
      quoteDecimals,
    };
  }

  private parseOrder = (order: Order): ParsedOrder => {
    return {
      quantity: this.toUiAmount(order.quantity, this.tokens[0]),
      price: this.toUiPrice(OrderBook.getPriceFromKey(order.key)),
    };
  };

  private toUiAmount(amount: JSBI | BN | string, token: { decimals?: number }): number {
    const power = new Decimal(10).toPower(token.decimals ?? 9);
    return new Decimal(amount.toString()).div(power).toNumber();
  }

  private toProgramAmount(amount: string | number, token: { decimals?: number }): JSBI {
    const power = new Decimal(10).toPower(token.decimals ?? 9);
    return JSBI.BigInt(new Decimal(amount).mul(power).toint().toString());
  }

  private toUiPrice(lotPrice: BN) {
    const p0 = new Decimal(10).pow(this.tokens[0].decimals);
    const p1 = new Decimal(10).pow(this.tokens[1].decimals);
    const lot0 = this.market.config.t0LotSize.toNumber();
    const lot1 = this.market.config.t1LotSize.toNumber();
    return new Decimal(lotPrice.toString()).div(p1.div(lot1)).mul(p0.div(lot0)).toNumber();
  }

  private isBetterOffer(side: number, a: number, b: number) {
    if (!a) return false;
    if (!b) return true;
    return !side ? a <= b : a >= b;
  }

  private getBetterOffer(side: number, a: number, b: number) {
    if (!a) return b;
    if (!b) return a;
    return !side ? Math.min(a, b) : Math.max(a, b);
  }

  evaluateOrder(side: number, amount?: number, limitPrice?: number, limitTotal?: number): OrderQuoteResult {
    let pool = this.pool;
    const offers = !side ? this.orders.asks : this.orders.bids;
    const { lotSize, tickSize } = this.formatting;
    const hasVolume = Number(amount) > 0 || Number(limitTotal) > 0;
    amount = amount ?? Infinity;
    limitTotal = limitTotal ?? Infinity;
    limitPrice = limitPrice ?? 0;
    let remaining = amount;
    if (!remaining) {
      remaining = lotSize;
    }
    let remainingTotal = limitTotal;
    if (!remainingTotal) {
      remainingTotal = tickSize;
    }
    let offerIndex = 0;
    const totals = {
      filled: 0,
      cost: 0,
      lpFilled: 0,
      lpCost: 0,
      orderFilled: 0,
      orderCost: 0,
    };
    let lpPrice = pool[0] ? pool[1] / pool[0] : 0;
    const minimumLiquidityX = this.toUiAmount(new BN(100), this.tokens[0]);
    const minimumLiquidityY = this.toUiAmount(new BN(100), this.tokens[1]);
    const hasLp = pool[0] > minimumLiquidityX && pool[1] > minimumLiquidityY;
    let computeSteps = 0;
    let lastMatchPrice = 0;
    while (remaining > 0 && remainingTotal > 0) {
      const offer = offers[offerIndex++];
      const offerPrice = offer ? Number(offer.price) : 0;
      if (hasLp) {
        const x0 = Math.max(pool[0] - minimumLiquidityX, 0);
        const lpPrice = pool[1] / pool[0];
        const targetPrice = this.getBetterOffer(side, offerPrice, limitPrice);
        if (!targetPrice || this.isBetterOffer(side, lpPrice, targetPrice)) {
          const c = new Decimal(pool[0]).mul(pool[1]);
          const m = targetPrice ? Math.sqrt(c.div(targetPrice).toNumber()) : 0;
          const maxX = Math.min(c.div(minimumLiquidityY).toNumber(), x0);
          let matchSize = targetPrice ? (side == 0 ? x0 - m : Math.min(m - x0, maxX)) : Infinity;
          if (matchSize > 0) {
            let maxFillable = Infinity;
            if (remainingTotal != Infinity) {
              const y = side == 0 ? pool[1] + remainingTotal : Math.max(pool[1] - remainingTotal, minimumLiquidityY);
              const x = Math.max(c.div(y).toNumber(), minimumLiquidityX);
              maxFillable = Math.abs(x - x0);
            }
            const filled = Math.min(matchSize, remaining, maxFillable, maxX);
            const x = side == 0 ? pool[0] - filled : pool[0] + filled;
            const y = c.div(x).toNumber();
            const cost = Math.min(Math.abs(pool[1] - y), remainingTotal);
            pool = [x, y];
            remaining -= filled;
            totals.filled += filled;
            totals.cost += cost;
            totals.lpFilled += filled;
            totals.lpCost += cost;
            if (remainingTotal != Infinity) {
              remainingTotal -= cost;
            }
            if (lastMatchPrice != lpPrice) {
              computeSteps++;
              lastMatchPrice = cost / filled;
            }
          }
        }
      }

      if (
        remaining > 0 &&
        remainingTotal > 0 &&
        offer &&
        (limitPrice ? this.isBetterOffer(side, offerPrice, limitPrice) : true)
      ) {
        const filled = Math.min(
          Number(offer.quantity),
          remaining,
          remainingTotal != Infinity ? remainingTotal / offerPrice : Infinity,
        );
        const cost = filled * offerPrice;
        totals.filled += filled;
        totals.cost += cost;
        totals.orderFilled += filled;
        totals.orderCost += cost;
        if (remainingTotal != Infinity) {
          remainingTotal -= cost;
        }
        remaining -= filled;
        computeSteps++;
        lastMatchPrice = offerPrice;
      } else {
        break;
      }
    }
    if (limitPrice) {
      remaining = Math.min(remaining, remainingTotal / limitPrice);
    }
    return {
      ...totals,
      lpPrice,
      unitPrice: totals.filled ? totals.cost / totals.filled : 0,
      lpUnitPrice: totals.lpFilled ? totals.lpCost / totals.lpFilled : 0,
      orderUnitPrice: totals.orderFilled ? totals.orderCost / totals.orderFilled : 0,
      quantity: hasVolume ? totals.filled + remaining : 0,
      remaining: limitPrice ? remaining : 0,
      remainingTotal: limitPrice ? limitPrice * remaining : 0,
      computeSteps,
      output: this.applyFees(totals, side),
    };
  }

  private applyFees(totals: { lpFilled: number; orderFilled: number; lpCost: number; orderCost: number }, side: number) {
    const { maker, taker } = this.feeRates;
    const [lpAmount, orderAmount] = !side ? [totals.lpFilled, totals.orderFilled] : [totals.lpCost, totals.orderCost];
    const feeAmount = (lpAmount * (maker + taker) + orderAmount * taker) / FEE_BPS_BASE;
    const grossAmount = lpAmount + orderAmount;
    return {
      grossAmount,
      netAmount: grossAmount - feeAmount,
      feeAmount,
      feePct: (feeAmount / grossAmount) * 100,
    };
  }

  getQuote(params: QuoteParams): Quote {
    const side = params.destinationMint.equals(this.market.t0) ? Side.BID : Side.ASK;
    const inMode = params.swapMode == SwapMode.ExactIn;
    const inputSide = inMode ? side : 1 - side;
    const inputToken = this.tokens[1 - inputSide];
    const amountUi = this.toUiAmount(new BN(params.amount.toString()), inputToken);
    const outToken = this.tokens[side];
    const inToken = this.tokens[1 - side];
    const useTotal = inMode ? !side : side;
    const result = this.evaluateOrder(side, !useTotal ? amountUi : undefined, 0, useTotal ? amountUi : undefined);
    const basePrice = this.basePrices[side];
    const { feeAmount: feeAmountUi, feePct, grossAmount: grossAmountUi } = result.output;
    const feeAmount = this.toProgramAmount(feeAmountUi, outToken);
    const netOutAmount = JSBI.subtract(this.toProgramAmount(grossAmountUi, outToken), feeAmount);
    const resultInAmount = this.toProgramAmount(!side ? result.cost : result.filled, inToken);
    const [inAmount, outAmount] = inMode ? [params.amount, netOutAmount] : [resultInAmount, netOutAmount];
    return {
      feeMint: outToken.address.toString(),
      feeAmount,
      feePct,
      inAmount,
      outAmount,
      notEnoughLiquidity: result.remaining > 0 && result.remainingTotal > 0,
      priceImpactPct: (Math.abs(basePrice - result.unitPrice) / result.unitPrice) * 100,
    };
  }
}
