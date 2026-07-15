using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using static System.Net.WebRequestMethods;

namespace YourNamespace.Services
{
    public class RngFileService
    {
        private readonly string _dataLakePath = "https://jrgmonkerdatalake.blob.core.windows.net/onlinerangedata/25LJ_25HJ_25CO_15BTN_25SB_11BB/0.rng"; // Update this path

        public async Task<Dictionary<string, (double Strategy, double EV)>> ParseRngFileAsync(string fileName)
        {
            var filePath = Path.Combine(_dataLakePath, fileName);
            if (!System.IO.File.Exists(filePath))
                throw new FileNotFoundException($"File not found: {fileName}");

            var data = new Dictionary<string, (double Strategy, double EV)>();

            string[] lines = await System.IO.File.ReadAllLinesAsync(filePath);

            for (int i = 0; i < lines.Length; i += 2)
            {
                if (i + 1 >= lines.Length) continue;

                string handName = lines[i].Trim();
                string[] values = lines[i + 1].Split(';');

                if (values.Length != 2) continue;

                if (double.TryParse(values[0], out double strategy) &&
                    double.TryParse(values[1], out double ev))
                {
                    data[handName] = (strategy, ev);
                }
            }

            return data;
        }
    }
}
