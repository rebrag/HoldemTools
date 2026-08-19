// Controllers/SharedController.cs
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PokerRangeAPI2.Data;
using System.Threading.Tasks;

namespace PokerRangeAPI2.Controllers
{
    // Public replay endpoint. Anyone holding the share link can read the hand —
    // no Firebase token and no auth cookie. The unguessable token is the only
    // access control, so the whole controller is anonymous.
    [ApiController]
    [Route("api/shared")]
    [AllowAnonymous]
    [EnableCors("AllowWebClients")] // let the web app's origin read shared hands cross-origin
    public class SharedController : ControllerBase
    {
        private readonly AppDbContext _db;

        public SharedController(AppDbContext db)
        {
            _db = db;
        }

        public class SharedHandResponse
        {
            // Returned EXACTLY as stored — the client decodes an embedded payload,
            // so the text must not be modified or stripped.
            public string RawText { get; set; } = default!;

            // The hand's server id. Not sensitive: every id-keyed endpoint
            // authorizes by owner, so knowing an id grants nothing. It lets a
            // signed-in owner viewing their own share link resolve extras that
            // are keyed by hand id (e.g. the replay page's "view solution"
            // button, which reads the per-viewer solved-boards index).
            public int Id { get; set; }
        }

        // GET /api/shared/{token}
        // Returns the shared hand's rawText, or 404 if the token is unknown or revoked.
        [HttpGet("{token}")]
        public async Task<ActionResult<SharedHandResponse>> GetByToken(string token)
        {
            if (string.IsNullOrWhiteSpace(token))
            {
                return NotFound();
            }

            var hand = await _db.HandHistories
                .AsNoTracking()
                .FirstOrDefaultAsync(h => h.ShareToken == token);

            if (hand == null)
            {
                // Unknown or revoked token.
                return NotFound();
            }

            return Ok(new SharedHandResponse { RawText = hand.RawText, Id = hand.Id });
        }
    }
}
