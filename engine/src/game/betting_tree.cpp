#include "game/betting_tree.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace engine {

namespace {

struct Builder {
  const RiverTreeParams& params;
  PublicTree tree;

  NodeId add(Node n) {
    tree.nodes.push_back(n);
    return static_cast<NodeId>(tree.nodes.size() - 1);
  }

  // Expand the decision node `id`. `raises` counts bets+raises this street;
  // `last_increment` is the previous bet/raise delta (min-raise floor).
  void expand(NodeId id, int raises, Chips last_increment) {
    const Node parent = tree[id];
    const int actor = parent.actor;
    const int other = 1 - actor;
    const Chips my_commit = parent.commit[actor];
    const Chips opp_commit = parent.commit[other];
    const Chips facing = opp_commit - my_commit;
    const Chips effective = params.effective_stack;
    const double pot_now = static_cast<double>(params.pot + parent.commit[0] + parent.commit[1]);

    struct Child {
      Node node;
      bool decision;
      Chips increment = 0;
    };
    std::vector<Child> children;

    auto make_node = [&](NodeKind kind, ActionKind ak, Chips new_commit) {
      Node n;
      n.kind = kind;
      n.parent = id;
      n.action_kind = ak;
      n.actor = kind == NodeKind::Decision ? static_cast<std::uint16_t>(other) : kNoSeat;
      n.commit = parent.commit;
      n.commit[actor] = new_commit;
      n.action_amount = new_commit;
      n.pot = params.pot + n.commit[0] + n.commit[1];
      return n;
    };

    // Collect candidate raise-to / bet-to street totals, dedupe, clamp.
    auto add_sizes = [&](const std::vector<double>& pcts, bool is_raise) {
      std::vector<Chips> totals;
      for (double pct : pcts) {
        Chips target;
        if (is_raise) {
          const double pot_after_call = pot_now + static_cast<double>(facing);
          Chips raise_add = static_cast<Chips>(std::llround(pct / 100.0 * pot_after_call));
          if (raise_add < last_increment) raise_add = last_increment;  // min-raise
          if (raise_add < 1) raise_add = 1;
          target = opp_commit + raise_add;
        } else {
          Chips bet = static_cast<Chips>(std::llround(pct / 100.0 * pot_now));
          if (bet < 1) bet = 1;
          target = my_commit + bet;
        }
        if (target >= static_cast<Chips>(params.sizing.allin_threshold *
                                         static_cast<double>(effective)) ||
            target > effective) {
          target = effective;
        }
        if (target <= opp_commit) continue;  // must exceed a call
        totals.push_back(target);
      }
      std::sort(totals.begin(), totals.end());
      totals.erase(std::unique(totals.begin(), totals.end()), totals.end());
      for (Chips target : totals) {
        Child c;
        c.node = make_node(NodeKind::Decision, ActionKind::Bet, target);
        c.decision = true;
        c.increment = target - opp_commit;
        children.push_back(c);
      }
    };

    if (facing == 0) {
      // Check: ends the street when the in-position seat (1) acts.
      Node chk = make_node(actor == 1 ? NodeKind::Terminal : NodeKind::Decision,
                           ActionKind::CheckCall, my_commit);
      if (actor == 1) {
        chk.terminal_kind = TerminalKind::Showdown;
        chk.actor = kNoSeat;
      }
      children.push_back({chk, actor != 1, 0});
      if (my_commit < effective) add_sizes(params.sizing.bets, false);
    } else {
      Node fold = make_node(NodeKind::Terminal, ActionKind::Fold, my_commit);
      fold.terminal_kind = TerminalKind::Fold;
      fold.fold_winner = static_cast<std::uint16_t>(other);
      children.push_back({fold, false, 0});

      Node call = make_node(NodeKind::Terminal, ActionKind::CheckCall, opp_commit);
      call.terminal_kind = TerminalKind::Showdown;
      children.push_back({call, false, 0});

      if (raises < params.sizing.max_raises && opp_commit < effective) {
        add_sizes(params.sizing.raises, true);
      }
    }

    const NodeId first = static_cast<NodeId>(tree.nodes.size());
    for (Child& c : children) add(c.node);
    tree[id].first_child = first;
    tree[id].num_children = static_cast<std::uint16_t>(children.size());

    for (std::size_t i = 0; i < children.size(); ++i) {
      if (!children[i].decision) continue;
      const NodeId cid = first + static_cast<NodeId>(i);
      const bool was_aggressive = tree[cid].action_kind == ActionKind::Bet;
      expand(cid, raises + (was_aggressive ? 1 : 0),
             was_aggressive ? children[i].increment : last_increment);
    }
  }
};

}  // namespace

PublicTree build_river_tree(const RiverTreeParams& params) {
  if (params.pot <= 0) throw std::runtime_error("river tree needs a positive root pot");
  if (params.effective_stack < 0) throw std::runtime_error("negative effective stack");
  Builder builder{params, {}};
  Node root;
  root.kind = NodeKind::Decision;
  root.actor = 0;
  root.street = Street::River;
  root.pot = params.pot;
  builder.add(root);
  builder.expand(0, 0, 0);
  for (Node& n : builder.tree.nodes) n.street = Street::River;
  builder.tree.finalize();
  return builder.tree;
}

}  // namespace engine
