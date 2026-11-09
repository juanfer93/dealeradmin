export type VehicleIntent = 'buy' | 'sell' | '';

const SELL_STATEMENT = /\b(?:(?:i(?:'m| am)|we(?:'re| are))\s+(?:(?:only|just)\s+)?(?:selling|trying to sell|looking to sell|planning to sell)|(?:i|we)\s+(?:want|need|would like)\s+to sell|selling\s+my|sell\s+my|(?:quiero|necesito|voy a|estoy|estamos)\s+(?:vender|vendiendo)|(?:vender|vendiendo)\s+mi)\b/i;
const BUY_STATEMENT = /\b(?:(?:i(?:'m| am)|we(?:'re| are))\s+(?:looking for|interested in buying|buying)|(?:i|we)\s+(?:want|need|would like)\s+to buy|(?:busco|estoy buscando|quiero|necesito)\s+(?:comprar|un[oa]?\s+))\b/i;
const SELL_PROMPT = /\b(?:sell your|looking to sell|selling your|or just sell it|or just sell)\b/i;

/**
 * Infer the lead's current vehicle intent from conversational statements.
 * Avoids inferring intent from a bot asking whether a customer wants to sell.
 * A one-word "selling" reply only counts when the transcript contains a
 * preceding sell-vs-buy prompt.
 */
export function inferVehicleIntent(...sources: Array<string | null | undefined>): VehicleIntent {
  const lines = sources
    .flatMap((source) => String(source ?? '').replace(/\r\n?/g, '\n').split(/\n+/))
    .map((line) => line.trim())
    .filter(Boolean);
  const fullSource = lines.join('\n');
  let lastIntent: { intent: Exclude<VehicleIntent, ''>; index: number } | undefined;

  lines.forEach((line, index) => {
    const normalized = line.replace(/[.,!?¡¿]+/g, ' ').replace(/\s+/g, ' ').trim();
    const sellNegated = /\b(?:not|never|no|don't|do not|isn't|aren't|no estoy|no quiero|no voy a)\s+(?:(?:trying|looking)\s+to\s+)?sell(?:ing)?\b/i.test(normalized);
    if (!sellNegated && SELL_STATEMENT.test(normalized)) lastIntent = { intent: 'sell', index };
    else if (!sellNegated && /^(?:selling|just selling|only selling|just sell it|solo vender|solo venderlo|solo venderla)$/i.test(normalized)
      && SELL_PROMPT.test(fullSource)) lastIntent = { intent: 'sell', index };

    if (BUY_STATEMENT.test(normalized)) lastIntent = { intent: 'buy', index };
  });

  return lastIntent?.intent ?? '';
}
