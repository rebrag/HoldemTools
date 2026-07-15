export function wilsonHalf(p: number, n: number, z: number) {
  if (n <= 0) return 1;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const term = p * (1 - p) / n + z2 / (4 * n * n);
  return (z / denom) * Math.sqrt(term);
}
