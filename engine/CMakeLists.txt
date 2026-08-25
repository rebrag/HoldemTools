cmake_minimum_required(VERSION 3.24)
project(holdemtools_engine CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# SIMD ISA level. Never hardcode: the dev machine has AVX-512 but the
# deployment server does not. AVX2 is the floor we ship.
set(ENGINE_SIMD "AVX2" CACHE STRING "SIMD ISA level: SSE2 | AVX2 | AVX512")
set_property(CACHE ENGINE_SIMD PROPERTY STRINGS SSE2 AVX2 AVX512)

include(FetchContent)

FetchContent_Declare(nlohmann_json
  URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz
  URL_HASH SHA256=d6c65aca6b1ed68e7a182f4757257b107ae403032760ed6ef121c9d55e81757d
)
FetchContent_Declare(doctest
  URL https://github.com/doctest/doctest/archive/refs/tags/v2.4.11.tar.gz
  URL_HASH SHA256=632ed2c05a7f53fa961381497bf8069093f0d6628c5f26286161fbd32a560186
)
FetchContent_MakeAvailable(nlohmann_json doctest)

# --- Warning / codegen flags ---------------------------------------------
# MSVC is the primary compiler; code must stay portable to clang-cl and GCC.
# Floating point stays strict everywhere in the solver core: reproducibility
# matters for PioSolver validation. Never add fast-math.
add_library(engine_flags INTERFACE)
if(MSVC)
  target_compile_options(engine_flags INTERFACE /permissive- /W4 /WX /EHsc /fp:precise)
  target_compile_definitions(engine_flags INTERFACE _CRT_SECURE_NO_WARNINGS)
  if(ENGINE_SIMD STREQUAL "AVX512")
    target_compile_options(engine_flags INTERFACE /arch:AVX512)
  elseif(ENGINE_SIMD STREQUAL "AVX2")
    target_compile_options(engine_flags INTERFACE /arch:AVX2)
  endif() # SSE2 is the MSVC x64 default
else()
  target_compile_options(engine_flags INTERFACE -Wall -Wextra -Werror)
  if(ENGINE_SIMD STREQUAL "AVX512")
    target_compile_options(engine_flags INTERFACE -march=x86-64-v4)
  elseif(ENGINE_SIMD STREQUAL "AVX2")
    target_compile_options(engine_flags INTERFACE -march=x86-64-v3)
  endif()
endif()

# --- Core library ---------------------------------------------------------
add_library(engine_core STATIC
  src/cli/args.cpp
  src/config/config.cpp
  src/game/betting_tree.cpp
  src/game/nlhe_river.cpp
  src/game/public_tree.cpp
  src/eval/hand_eval.cpp
  src/eval/terminal.cpp
  src/solver/cfr.cpp
  src/solver/best_response.cpp
  src/solver/agents.cpp
  src/solver/memory.cpp
  src/io/local_store.cpp
  src/io/artifact_writer.cpp
  src/io/artifact_reader.cpp
  src/io/dump_json.cpp
)
target_include_directories(engine_core PUBLIC src)
target_link_libraries(engine_core PUBLIC nlohmann_json::nlohmann_json engine_flags)

# --- CLI ------------------------------------------------------------------
add_executable(engine src/main.cpp)
target_link_libraries(engine PRIVATE engine_core)

# --- Tests ----------------------------------------------------------------
enable_testing()
add_executable(engine_tests
  tests/test_main.cpp
  tests/test_kuhn.cpp
  tests/test_leduc.cpp
  tests/test_tree.cpp
  tests/test_terminal.cpp
  tests/test_memory.cpp
  tests/test_artifact_roundtrip.cpp
)
target_link_libraries(engine_tests PRIVATE engine_core doctest::doctest)
add_test(NAME engine_tests COMMAND engine_tests)
