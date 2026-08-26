#include "util/parallel.hpp"

#include <algorithm>

namespace engine {

int resolve_thread_count(int configured) {
  if (configured > 0) return configured;
  const unsigned hw = std::thread::hardware_concurrency();
  const int detected = hw == 0 ? 1 : static_cast<int>(hw);
  // Negative means "leave this many cores alone" - handy on the dev box,
  // where the solver shares the machine with PioSolver.
  const int count = configured < 0 ? detected + configured : detected;
  return std::max(1, count);
}

ThreadPool::ThreadPool(int threads) : threads_(std::max(1, threads)) {
  // The caller is one of the workers, so only threads_ - 1 are spawned.
  workers_.reserve(static_cast<std::size_t>(threads_ - 1));
  for (int i = 1; i < threads_; ++i) workers_.emplace_back([this] { worker_loop(); });
}

ThreadPool::~ThreadPool() {
  {
    std::lock_guard<std::mutex> lock(mu_);
    stopping_ = true;
  }
  cv_.notify_all();
  for (std::thread& t : workers_) t.join();
}

bool ThreadPool::pending_locked() const {
  for (const Batch* b : batches_) {
    if (b->next.load(std::memory_order_relaxed) < b->count) return true;
  }
  return false;
}

ThreadPool::Claim ThreadPool::claim_locked() {
  // Newest batch first: a nested split is deeper in the tree and closer to
  // completing, so draining it first bounds the helper recursion depth.
  for (auto it = batches_.rbegin(); it != batches_.rend(); ++it) {
    Batch* b = *it;
    const int i = b->next.load(std::memory_order_relaxed);
    if (i < b->count) {
      b->next.store(i + 1, std::memory_order_relaxed);
      return {b, i};
    }
  }
  return {};
}

void ThreadPool::run(Claim claim) {
  Batch* batch = claim.batch;
  try {
    (*batch->fn)(claim.index);
  } catch (...) {
    std::lock_guard<std::mutex> lock(batch->error_mu);
    if (!batch->error) batch->error = std::current_exception();
  }
  // Nothing may touch `batch` after this: the owner's wait loop ends the
  // moment the count reaches zero, and the Batch lives on its stack.
  batch->remaining.fetch_sub(1, std::memory_order_acq_rel);
}

bool ThreadPool::run_one() {
  Claim claim;
  {
    std::lock_guard<std::mutex> lock(mu_);
    claim = claim_locked();
  }
  if (!claim.batch) return false;
  run(claim);
  return true;
}

void ThreadPool::worker_loop() {
  for (;;) {
    Claim claim;
    {
      std::unique_lock<std::mutex> lock(mu_);
      cv_.wait(lock, [this] { return stopping_ || pending_locked(); });
      if (stopping_) return;
      claim = claim_locked();
    }
    if (claim.batch) run(claim);
  }
}

void ThreadPool::parallel_for(int n, const std::function<void(int)>& fn) {
  if (n <= 0) return;
  if (threads_ <= 1 || n == 1) {
    for (int i = 0; i < n; ++i) fn(i);
    return;
  }

  Batch batch;
  batch.fn = &fn;
  batch.count = n;
  batch.remaining.store(n, std::memory_order_relaxed);
  {
    std::lock_guard<std::mutex> lock(mu_);
    batches_.push_back(&batch);
  }
  cv_.notify_all();

  while (batch.remaining.load(std::memory_order_acquire) > 0) {
    // Help rather than sleep. When there is nothing left to claim anywhere,
    // the only outstanding work is a task already running on another thread,
    // so yielding until it lands is the whole wait.
    if (!run_one()) std::this_thread::yield();
  }

  {
    std::lock_guard<std::mutex> lock(mu_);
    batches_.erase(std::remove(batches_.begin(), batches_.end(), &batch), batches_.end());
  }
  if (batch.error) std::rethrow_exception(batch.error);
}

}  // namespace engine
