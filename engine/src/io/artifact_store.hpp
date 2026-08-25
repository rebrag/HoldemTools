#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace engine {

// All artifact storage goes through this interface: open / write / seek /
// read-range / close over an opaque path. Solver code never touches the
// filesystem directly, so an AdlsStore (HTTP Range reads, block uploads)
// drops in later without touching solver code. LocalStore is the only
// implementation in this pass; do not link cloud SDKs into the engine.
class ArtifactStore {
 public:
  virtual ~ArtifactStore() = default;

  // Writing: one open stream at a time.
  virtual void open_write(const std::string& path) = 0;
  virtual void write(const void* data, std::size_t size) = 0;
  virtual std::uint64_t tell() = 0;
  virtual void seek(std::uint64_t offset) = 0;  // within the open write stream
  virtual void close_write() = 0;

  // Reading: stateless range reads.
  virtual std::vector<std::uint8_t> read_range(const std::string& path, std::uint64_t offset,
                                               std::uint64_t length) = 0;
  virtual std::uint64_t size(const std::string& path) = 0;
};

class LocalStore final : public ArtifactStore {
 public:
  ~LocalStore() override;
  void open_write(const std::string& path) override;
  void write(const void* data, std::size_t size) override;
  std::uint64_t tell() override;
  void seek(std::uint64_t offset) override;
  void close_write() override;
  std::vector<std::uint8_t> read_range(const std::string& path, std::uint64_t offset,
                                       std::uint64_t length) override;
  std::uint64_t size(const std::string& path) override;

 private:
  void* file_ = nullptr;  // FILE*, kept opaque in the header
};

}  // namespace engine
