import { decodeCsvBytes } from './decode';

describe('decodeCsvBytes', () => {
  it('UTF-8, sonst Windows-1252', () => {
    expect(decodeCsvBytes(new TextEncoder().encode('Gläubiger'))).toBe('Gläubiger');
    expect(
      decodeCsvBytes(new Uint8Array([0x47, 0x6c, 0xe4, 0x75, 0x62, 0x69, 0x67, 0x65, 0x72])),
    ).toBe('Gläubiger');
  });
});
