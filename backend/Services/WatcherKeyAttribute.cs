// Services/WatcherKeyAttribute.cs
using System;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Configuration;

namespace PokerRangeAPI2.Services
{
    /// <summary>
    /// Authenticates the solve watcher daemon via a static shared key in the
    /// X-Watcher-Key header (config "Watcher:ApiKey"). The watcher is one
    /// trusted process on the owner's PC, not a Firebase user, so a long
    /// random secret over HTTPS is the appropriate credential. Fails closed:
    /// with no key configured the watcher endpoints answer 503.
    /// </summary>
    [AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
    public class WatcherKeyAttribute : Attribute, IAuthorizationFilter
    {
        public const string HeaderName = "X-Watcher-Key";

        public void OnAuthorization(AuthorizationFilterContext context)
        {
            var config = context.HttpContext.RequestServices
                .GetService(typeof(IConfiguration)) as IConfiguration;
            var expected = config?["Watcher:ApiKey"];
            if (string.IsNullOrWhiteSpace(expected))
            {
                context.Result = new StatusCodeResult(StatusCodes.Status503ServiceUnavailable);
                return;
            }

            var provided = context.HttpContext.Request.Headers[HeaderName].ToString();
            if (provided.Length == 0 ||
                !CryptographicOperations.FixedTimeEquals(
                    Encoding.UTF8.GetBytes(provided),
                    Encoding.UTF8.GetBytes(expected)))
            {
                context.Result = new UnauthorizedResult();
            }
        }
    }
}
