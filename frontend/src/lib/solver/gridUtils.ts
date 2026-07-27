// src/utils/gridUtils.ts
export const generateSpiralOrder = (rows: number, cols: number): [number, number][] => {
    let top = 0, bottom = rows - 1, left = 0, right = cols - 1;
    const order: [number, number][] = [];
    while (top <= bottom && left <= right) {
      for (let j = left; j <= right; j++) {
        order.push([top, j]);
      }
      top++;
      for (let i = top; i <= bottom; i++) {
        order.push([i, right]);
      }
      right--;
      if (top <= bottom) {
        for (let j = right; j >= left; j--) {
          order.push([bottom, j]);
        }
        bottom--;
      }
      if (left <= right) {
        for (let i = bottom; i >= top; i--) {
          order.push([i, left]);
        }
        left++;
      }
    }
    return order;
  };

/**
 * Lay [position, file] pairs into a rows x cols grid in spiral order (used so
 * the multi-range plate grid reads clockwise around the table). Cells beyond
 * the pair count are ["", ""] placeholders.
 */
export const orderPlatesSpiral = (
  positions: string[],
  files: string[],
  gridRows: number,
  gridCols: number
): (readonly [string, string])[] => {
  const totalCells = gridRows * gridCols;
  const base = positions.map((p, i) => [p, files[i]] as const);
  const padded = [...base];
  while (padded.length < totalCells) padded.push(["", ""]);
  const grid: (readonly [string, string])[] = new Array(totalCells).fill([
    "",
    "",
  ]);
  generateSpiralOrder(gridRows, gridCols).forEach(([r, c], i) => {
    grid[r * gridCols + c] = padded[i];
  });
  return grid;
};
