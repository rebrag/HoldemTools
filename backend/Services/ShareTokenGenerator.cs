// Services/ShareTokenGenerator.cs
using System;
using System.Security.Cryptography;

namespace PokerRangeAPI2.Services
{
    /// <summary>
    /// Generates public share tokens for hand histories.
    ///
    /// The token is the ONLY access control on the public GET /api/shared/{token}
    /// route, so it must be short, url-safe, and UNGUESSABLE — never derived from
    /// the numeric hand id. We use 22 characters of cryptographically-random base62
    /// (~130 bits of entropy), which is url-safe with no reserved characters.
    /// </summary>
    public static class ShareTokenGenerator
    {
        private const string Alphabet =
            "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"; // base62
        private const int DefaultLength = 22;

        public static string NewToken(int length = DefaultLength)
        {
            if (length <= 0)
            {
                throw new ArgumentOutOfRangeException(nameof(length));
            }

            var chars = new char[length];

            // Rejection sampling keeps the distribution over the 62-char alphabet
            // uniform (no modulo bias), so every token is equally likely.
            const int max = 256 - (256 % 62); // largest multiple of 62 <= 256 (248)
            var buffer = new byte[length];

            var produced = 0;
            while (produced < length)
            {
                RandomNumberGenerator.Fill(buffer);
                for (var i = 0; i < buffer.Length && produced < length; i++)
                {
                    var b = buffer[i];
                    if (b >= max)
                    {
                        continue; // discard biased values
                    }
                    chars[produced++] = Alphabet[b % 62];
                }
            }

            return new string(chars);
        }
    }
}
