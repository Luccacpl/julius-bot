export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function buildPrice(current: number, list?: number | null) {
  if (!Number.isFinite(current) || current <= 0) return null;
  const price = roundMoney(current);
  const original = list != null && Number.isFinite(list) ? roundMoney(list) : undefined;
  if (original && original > price + 0.009) {
    return {
      price,
      originalPrice: original,
      discountPercentage: Math.round((1 - price / original) * 1000) / 10,
    };
  }
  return { price, originalPrice: undefined, discountPercentage: undefined };
}
