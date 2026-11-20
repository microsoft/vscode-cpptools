// Module importer used by the compile_commands.json based tests
// (Clang-style module flags, carried by a clang++ compilation database entry).

import math;
import geometry;

// Sentinel probe: this define is only provided by the compile_commands.json
// entry for this file. The test hovers on the use of the symbol below to
// verify that the compilation database entry -- including its module related
// flags -- was actually applied to this translation unit.
#ifdef CLANG_COMPILE_COMMANDS_SENTINEL
int clang_compile_commands_sentinel_value = 1;
#endif

int probe_clang_compile_commands()
{
    return clang_compile_commands_sentinel_value;
}

int main()
{
    return add(4, 5) + square_area(6) - math::k_answer;
}
