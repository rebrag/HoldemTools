// Controllers/SolutionsController.cs
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PokerRangeAPI2.Data;
using PokerRangeAPI2.Models;
using System;
using System.Threading.Tasks;

namespace PokerRangeAPI2.Controllers
{
    /// <summary>
    /// Per-viewer control over the solved-flops library.
    ///
    /// Removing a board hides it for the caller only. The solution blobs and
    /// the index blob are shared - the watcher is their single writer - so a
    /// destructive delete here would race the pipeline and take the board away
    /// from everyone. Hiding is reversible, which is what makes Undo honest.
    /// </summary>
    [ApiController]
    [Route("api/solutions")]
    [Authorize]
    public class SolutionsController : ControllerBase
    {
        private readonly AppDbContext _db;

        public SolutionsController(AppDbContext db)
        {
            _db = db;
        }

        public class SolutionRef
        {
            public string Stacks { get; set; } = "";
            public string NodeName { get; set; } = "";
            public string Board { get; set; } = "";
        }

        // POST api/solutions/hidden – remove a board from the caller's library.
        [HttpPost("hidden")]
        public async Task<IActionResult> Hide([FromBody] SolutionRef req)
        {
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid))
                return Unauthorized();

            if (req == null ||
                string.IsNullOrWhiteSpace(req.Stacks) ||
                string.IsNullOrWhiteSpace(req.NodeName) ||
                string.IsNullOrWhiteSpace(req.Board))
                return BadRequest("stacks, nodeName and board are required.");

            bool already = await _db.HiddenSolutions.AnyAsync(h =>
                h.UserId == uid &&
                h.Stacks == req.Stacks &&
                h.NodeName == req.NodeName &&
                h.Board == req.Board);

            // Idempotent: the client retries a hide after a failed request, and
            // a second one must not 500 on the unique index.
            if (!already)
            {
                _db.HiddenSolutions.Add(new HiddenSolution
                {
                    Id = Guid.NewGuid(),
                    UserId = uid,
                    Stacks = req.Stacks,
                    NodeName = req.NodeName,
                    Board = req.Board,
                    HiddenAtUtc = DateTimeOffset.UtcNow,
                });
                await _db.SaveChangesAsync();
            }

            return NoContent();
        }

        // DELETE api/solutions/hidden – put a hidden board back (Undo).
        [HttpDelete("hidden")]
        public async Task<IActionResult> Unhide([FromBody] SolutionRef req)
        {
            var uid = this.CurrentUid();
            if (string.IsNullOrWhiteSpace(uid))
                return Unauthorized();

            if (req == null ||
                string.IsNullOrWhiteSpace(req.Stacks) ||
                string.IsNullOrWhiteSpace(req.NodeName) ||
                string.IsNullOrWhiteSpace(req.Board))
                return BadRequest("stacks, nodeName and board are required.");

            var rows = await _db.HiddenSolutions
                .Where(h => h.UserId == uid &&
                            h.Stacks == req.Stacks &&
                            h.NodeName == req.NodeName &&
                            h.Board == req.Board)
                .ToListAsync();

            if (rows.Count > 0)
            {
                _db.HiddenSolutions.RemoveRange(rows);
                await _db.SaveChangesAsync();
            }

            return NoContent();
        }
    }
}
