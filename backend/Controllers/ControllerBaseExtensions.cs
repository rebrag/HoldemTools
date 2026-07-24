using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;

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
    }
}
