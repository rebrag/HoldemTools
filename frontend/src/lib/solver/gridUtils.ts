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
  