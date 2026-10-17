// Module interface unit using the MSVC-style file extension (.ixx).
//
// IntelliSense support for C++20 modules is tracked at
// https://github.com/microsoft/vscode-cpptools/issues/6302. These sources are
// used by the CppModulesProject scenario tests to cover the extension-side
// behavior that module based projects rely on.

export module geometry;

export int square_area(int side)
{
    return side * side;
}
