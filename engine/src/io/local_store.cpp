#include "io/artifact_store.hpp"

#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <stdexcept>

namespace engine {

namespace {
std::FILE* as_file(void* f) { return static_cast<std::FILE*>(f); }

// 64-bit file positioning. Plain fseek/ftell take a 32-bit `long` on
// Windows, which silently corrupts every recorded offset past 2GB - a flop
// artifact is bigger than that.
#if defined(_WIN32)
std::int64_t tell64(std::FILE* f) { return _ftelli64(f); }
int seek64(std::FILE* f, std::int64_t offset) { return _fseeki64(f, offset, SEEK_SET); }
#else
std::int64_t tell64(std::FILE* f) { return ftello(f); }
int seek64(std::FILE* f, std::int64_t offset) { return fseeko(f, offset, SEEK_SET); }
#endif
}  // namespace

LocalStore::~LocalStore() {
  if (file_) std::fclose(as_file(file_));
}

void LocalStore::open_write(const std::string& path) {
  if (file_) throw std::runtime_error("LocalStore: write stream already open");
  const std::filesystem::path p(path);
  if (p.has_parent_path()) std::filesystem::create_directories(p.parent_path());
  file_ = std::fopen(path.c_str(), "wb");
  if (!file_) throw std::runtime_error("LocalStore: cannot open '" + path + "' for writing");
}

void LocalStore::write(const void* data, std::size_t size) {
  if (!file_) throw std::runtime_error("LocalStore: no open write stream");
  if (std::fwrite(data, 1, size, as_file(file_)) != size) {
    throw std::runtime_error("LocalStore: short write");
  }
}

std::uint64_t LocalStore::tell() {
  if (!file_) throw std::runtime_error("LocalStore: no open write stream");
  const std::int64_t pos = tell64(as_file(file_));
  if (pos < 0) throw std::runtime_error("LocalStore: tell failed");
  return static_cast<std::uint64_t>(pos);
}

void LocalStore::seek(std::uint64_t offset) {
  if (!file_) throw std::runtime_error("LocalStore: no open write stream");
  if (seek64(as_file(file_), static_cast<std::int64_t>(offset)) != 0) {
    throw std::runtime_error("LocalStore: seek failed");
  }
}

void LocalStore::close_write() {
  if (!file_) return;
  if (std::fclose(as_file(file_)) != 0) {
    file_ = nullptr;
    throw std::runtime_error("LocalStore: close failed");
  }
  file_ = nullptr;
}

std::vector<std::uint8_t> LocalStore::read_range(const std::string& path, std::uint64_t offset,
                                                 std::uint64_t length) {
  std::FILE* f = std::fopen(path.c_str(), "rb");
  if (!f) throw std::runtime_error("LocalStore: cannot open '" + path + "' for reading");
  std::vector<std::uint8_t> data(length);
  if (seek64(f, static_cast<std::int64_t>(offset)) != 0 ||
      std::fread(data.data(), 1, length, f) != length) {
    std::fclose(f);
    throw std::runtime_error("LocalStore: range read failed on '" + path + "'");
  }
  std::fclose(f);
  return data;
}

std::uint64_t LocalStore::size(const std::string& path) {
  std::error_code ec;
  const auto s = std::filesystem::file_size(path, ec);
  if (ec) throw std::runtime_error("LocalStore: cannot stat '" + path + "'");
  return static_cast<std::uint64_t>(s);
}

}  // namespace engine
