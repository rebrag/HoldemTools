// Fingerprints every field of every node of several 2-seat postflop trees.
//
// Exists to prove one thing: generalizing build_postflop_tree to N seats left
// the HEADS-UP tree bit-identical. That tree is the Pio-gated artifact
// contract, so "the tests still pass" is not a strong enough claim - the
// tests check structure at a handful of nodes, and this checks every field of
// every node.
//
// Two digests, because one field changed on purpose: fold terminals now carry
// folded_mask, which the heads-up-only builder left at 0 because fold_winner
// already said everything at two seats. `all` therefore differs across the
// change and `no_folded_mask` must not.
//
// Usage: tree_hash   (prints the digests; compare across git revisions)

#include <cstdint>
#include <iomanip>
#include <iostream>
#include <string>
#include <vector>

#include "cards/cards.hpp"
#include "game/betting_tree.hpp"

using namespace engine;

namespace {

struct Digest {
  std::uint64_t all = 1469598103934665603ULL;
  std::uint64_t no_folded_mask = 1469598103934665603ULL;

  static void mix(std::uint64_t& h, std::uint64_t v) {
    for (int b = 0; b < 8; ++b) {
      h ^= (v >> (b * 8)) & 0xFF;
      h *= 1099511628211ULL;
    }
  }
  void add(std::uint64_t v) {
    mix(all, v);
    mix(no_folded_mask, v);
  }
  void add_folded_only(std::uint64_t v) { mix(all, v); }
};

Digest hash_tree(const PublicTree& tree) {
  Digest d;
  d.add(tree.nodes.size());
  d.add(tree.num_decision_nodes);
  d.add(tree.num_terminal_nodes);
  for (const Node& n : tree.nodes) {
    d.add(static_cast<std::uint64_t>(n.kind));
    d.add(static_cast<std::uint64_t>(n.street));
    d.add(static_cast<std::uint64_t>(n.action_kind));
    d.add(static_cast<std::uint64_t>(n.terminal_kind));
    d.add(n.actor);
    d.add(static_cast<std::uint64_t>(n.dealt_card + 1));
    d.add(static_cast<std::uint64_t>(n.action_amount));
    d.add(n.parent);
    d.add(n.first_child);
    d.add(n.num_children);
    d.add(n.decision_index);
    d.add(n.terminal_index);
    d.add(static_cast<std::uint64_t>(n.pot));
    d.add(n.board_mask);
    for (int s = 0; s < 2; ++s) d.add(static_cast<std::uint64_t>(n.commit[s]));
    d.add(n.fold_winner);
    d.add_folded_only(n.folded_mask);
  }
  return d;
}

PostflopTreeParams river_params() {
  PostflopTreeParams p;
  p.pot = 100;
  p.effective_stack = 900;
  p.start_street = Street::River;
  p.board_mask = cards_mask(parse_cards("Qs Jh 2h 8d 6c"));
  p.river.oop.bets = {50.0};
  p.river.oop.raises = {100.0};
  p.river.ip.bets = {50.0};
  p.river.ip.raises = {100.0};
  p.river.max_raises = 2;
  p.river.allin_threshold = 0.9;
  return p;
}

PostflopTreeParams turn_params() {
  PostflopTreeParams p;
  p.pot = 100;
  p.effective_stack = 300;
  p.start_street = Street::Turn;
  p.board_mask = cards_mask(parse_cards("Qs Jh 2h 8d"));
  p.turn.oop.bets = {75.0};
  p.turn.ip.bets = {75.0};
  p.turn.max_raises = 1;
  p.turn.oop.raises = {100.0};
  p.turn.ip.raises = {100.0};
  p.river.oop.bets = {50.0};
  p.river.ip.bets = {50.0};
  p.river.max_raises = 1;
  return p;
}

PostflopTreeParams donk_params() {
  PostflopTreeParams p;
  p.pot = 100;
  p.effective_stack = 1000;
  p.start_street = Street::Turn;
  p.board_mask = cards_mask(parse_cards("Qs Jh 2h 8d"));
  p.preflop_aggressor = Aggressor::Ip;
  p.turn.oop.bets = {50.0};
  p.turn.oop.donks = {};
  p.turn.ip.bets = {50.0};
  p.river.oop.bets = {50.0};
  p.river.oop.donks = {25.0};
  p.river.ip.bets = {50.0};
  return p;
}

PostflopTreeParams flop_params() {
  PostflopTreeParams p;
  p.pot = 100;
  p.effective_stack = 400;
  p.start_street = Street::Flop;
  p.board_mask = cards_mask(parse_cards("9c 5d Jc"));
  for (StreetSizing* s : {&p.flop, &p.turn, &p.river}) {
    s->oop.bets = {50.0};
    s->ip.bets = {50.0};
    s->max_raises = 0;
  }
  return p;
}

void report(const char* name, const PostflopTreeParams& p) {
  const PublicTree tree = build_postflop_tree(p);
  const Digest d = hash_tree(tree);
  std::cout << std::left << std::setw(10) << name << std::right << std::setw(9)
            << tree.nodes.size() << " nodes   all " << std::hex << std::setw(16) << std::setfill('0')
            << d.all << "   no_folded_mask " << std::setw(16) << d.no_folded_mask << std::dec
            << std::setfill(' ') << "\n";
}

}  // namespace

int main() {
  report("river", river_params());
  report("turn", turn_params());
  report("donk", donk_params());
  report("flop", flop_params());
  return 0;
}
