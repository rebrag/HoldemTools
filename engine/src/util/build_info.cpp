#include "util/build_info.hpp"

#include "engine_build_id.hpp"

namespace engine {

const char* engine_build_id() { return HT_ENGINE_BUILD; }

}  // namespace engine
