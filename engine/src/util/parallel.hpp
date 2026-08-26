#pragma once
#include <atomic>
#include <condition_variable>
#include <cstddef>
#include <exception>
#include <functional>
#include <mutex>
#include <thread>
#include <vector>

namespace engine {

// Resolve a config `threads` value to a concrete worker count: 0 means "one
// per hardware thread", negative means "all but that many", and anything
// else is taken literally. Always >= 1.
int resolve_thread_count(int configured);

// Fork-join pool for the solver's subtree parallelism.
//
// Two properties the CFR traversal depends on:
//   - The calling thread PARTICIPATES in its own batch, so a pool sized to
//     the core count does not leave the caller idle.
//   - parallel_for is RE-ENTRANT. A thread waiting on its own batch runs
//     tasks from any pending batch (newest first) rather than blocking, so
//     nested splits further down the tree can never deadlock against a pool
//     whose workers are all busy inside outer tasks.
//
// Tasks must be independent: the pool imposes no ordering and no barrier
// other than the end of a parallel_for.
class ThreadPool {
 public:
  explicit ThreadPool(int threads);
  ~ThreadPool();
  ThreadPool(const ThreadPool&) = delete;
  ThreadPool& operator=(const ThreadPool&) = delete;

  int threads() const { return threads_; }

  // Run fn(i) for i in [0, n), returning once every call has finished.
  // Falls back to a plain loop for n <= 1 or a single-threaded pool.
  // An exception escaping fn is rethrown here after the batch drains.
  void parallel_for(int n, const std::function<void(int)>& fn);

 private:
  struct Batch {
    const std::function<void(int)>* fn = nullptr;
    int count = 0;
    std::atomic<int> next{0};
    std::atomic<int> remaining{0};
    std::mutex error_mu;
    std::exception_ptr error;
  };
  struct Claim {
    Batch* batch = nullptr;
    int index = 0;
  };

  Claim claim_locked();
  bool pending_locked() const;
  void run(Claim claim);
  bool run_one();
  void worker_loop();

  int threads_;
  std::vector<std::thread> workers_;
  mutable std::mutex mu_;
  std::condition_variable cv_;
  std::vector<Batch*> batches_;  // stack; newest last, and preferred
  bool stopping_ = false;
};

}  // namespace engine
