using System;
using System.Linq;
using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;

namespace PokerRangeAPI2.Controllers
{
    public static class ControllerBaseExtensions
    {
        /// <summary>
        /// Firebase uid from the verified JWT. Firebase puts it in both
        /// "user_id" and "sub"; NameIdentifier covers claim-type mapping.
        /// </summary>
        public static string? CurrentUid(this ControllerBase controller) =>
            controller.User.FindFirst("user_id")?.Value
            ?? controller.User.FindFirst("sub")?.Value
            ?? controller.User.FindFirst(ClaimTypes.NameIdentifier)?.Value;

        /// <summary>
        /// Whether the verified caller is an admin: their email is listed in
        /// Admin:Emails (case-insensitive) or their uid in Admin:Uids. The
        /// default JWT inbound claim map renames "email" to ClaimTypes.Email,
        /// so both shapes are checked.
        /// </summary>
        public static bool IsAdmin(this ControllerBase controller, IConfiguration config)
        {
            var email = controller.User.FindFirst("email")?.Value
                ?? controller.User.FindFirst(ClaimTypes.Email)?.Value;
            var uid = controller.CurrentUid();
            var adminEmails = config.GetSection("Admin:Emails").Get<string[]>() ?? Array.Empty<string>();
            var adminUids = config.GetSection("Admin:Uids").Get<string[]>() ?? Array.Empty<string>();
            return (email != null && adminEmails.Contains(email, StringComparer.OrdinalIgnoreCase))
                || (uid != null && adminUids.Contains(uid, StringComparer.Ordinal));
        }
    }
}
