const uom = require('../services/uomConversionService');
describe('uomConversionService', () => {
  test('10 boxes of 100 are 1000 units', () => expect(uom.packageQuantityToBaseQuantity(10,100)).toBe(1000));
  test('normalizes decimal package cost with six-place rounding', () => {
    expect(uom.packagePriceToBaseUnitCost(10,4)).toBe(2.5);
    expect(uom.packagePriceToBaseUnitCost(1,3)).toBe(0.333333);
  });
  test.each([0,-1,1.5,NaN])('rejects invalid units per package %p', value => expect(() => uom.validateUnitsPerPackage(value)).toThrow());
  test('rejects zero quantity', () => expect(() => uom.packageQuantityToBaseQuantity(0,10)).toThrow());
  test('reverse conversion requires exact divisibility', () => {
    expect(uom.baseQuantityToPackageQuantity(1000,100)).toBe(10);
    expect(() => uom.baseQuantityToPackageQuantity(10,3)).toThrow(/not exactly divisible/);
  });
});