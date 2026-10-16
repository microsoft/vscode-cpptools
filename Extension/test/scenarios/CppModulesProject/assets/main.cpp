// Module importer used by the compile_commands.json based tests.
//
// Diagnostics on the import statements are expected until IntelliSense
// support for C++20 modules is available for all compilers
// (https://github.com/microsoft/vscode-cpptools/issues/6302).

import math;
import geometry;

int main()
{
    return add(1, 2) + square_area(3) - math::k_answer;
}
