import { describe, expect, it } from 'vitest';
import { recipeServingQuantity, recipeYieldPreview } from './recipe-scaling';
describe('measured SOP recipe scaling', () => {
  it('supports each confirmed serving size without an 80 ml default', () => {
    expect(recipeServingQuantity('30', '1000', '85')).toBe('2.550000');
    expect(recipeServingQuantity('30', '1000', '110')).toBe('3.300000');
    expect(recipeYieldPreview('1000', '85')).toEqual({
      fullServings: '11',
      remainder: '65.000000',
    });
  });
  it('uses measured finished yield rather than starting milk volume', () => {
    expect(recipeServingQuantity('30', '850', '85')).toBe('3.000000');
  });
  it('rounds once without floating point errors', () => {
    expect(recipeServingQuantity('1', '3', '1')).toBe('0.333333');
    expect(recipeServingQuantity('0.1', '0.3', '0.2')).toBe('0.066667');
  });
  it.each(['0', '-1', 'NaN', 'Infinity', '1 spoon', '70–80', '0.0000001'])(
    'rejects unresolved or invalid quantity %s',
    (value) => {
      expect(() => recipeServingQuantity(value, '1000', '85')).toThrow();
    },
  );
  it('rejects impossible servings and rounded-to-zero consumption', () => {
    expect(() => recipeYieldPreview('100', '110')).toThrow();
    expect(() => recipeServingQuantity('0.000001', '1000', '1')).toThrow();
  });
});
