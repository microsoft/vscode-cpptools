// Module interface unit using the GCC-style file extension (.cppm).
//
// IntelliSense support for C++20 modules is tracked at
// https://github.com/microsoft/vscode-cpptools/issues/6302. These sources are
// used by the CppModulesProject scenario tests to cover the extension-side
// behavior that module based projects rely on.

export module math;

export int add(int a, int b)
{
    return a + b;
}

export namespace math
{
    constexpr int k_answer = 42;
}

// Not exported; part of the module implementation only.
int implementation_detail()
{
    return math::k_answer;
}
