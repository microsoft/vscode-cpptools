// Module importer used by the compile_commands.json based tests.
//
// Diagnostics on the import statements are expected until IntelliSense
// support for C++20 modules is available for all compilers
// (https://github.com/microsoft/vscode-cpptools/issues/6302).

import math;
import geometry;

// Sentinel probe: this define is only provided by the compile_commands.json
// entry for this file. The test hovers on the use of the symbol below to
// verify that the compilation database entry -- including its module related
// flags -- was actually applied to this translation unit, rather than
// IntelliSense falling back to a default configuration.
#ifdef CPPMODULES_COMPILE_COMMANDS_SENTINEL
int compile_database_sentinel_value = 1;
#endif

int probe_compile_database()
{
    return compile_database_sentinel_value;
}

int main()
{
    return add(1, 2) + square_area(3) - math::k_answer;
}
