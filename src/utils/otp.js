// Generates a 6-digit numeric OTP as a string, e.g. "042917".
// Uses crypto.getRandomValues (Web Crypto, available natively in Workers)
// instead of Node's crypto.randomInt. Rejection sampling avoids modulo
// bias, same reasoning as the original: this gates email verification and
// password reset, so it shouldn't be guessable or predictable.
export function generateOTP() {
  const min = 100000;
  const max = 999999; // inclusive
  const range = max - min + 1;
  const maxUint32 = 0xffffffff;
  const limit = maxUint32 - (maxUint32 % range); // largest value usable without bias

  const buf = new Uint32Array(1);
  let value;
  do {
    crypto.getRandomValues(buf);
    value = buf[0];
  } while (value >= limit);

  return String(min + (value % range));
}
