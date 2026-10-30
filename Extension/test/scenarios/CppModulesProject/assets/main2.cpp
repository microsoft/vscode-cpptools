// Module importer used by the custom configuration provider tests
// (GCC-style module compiler arguments).

import math;
import geometry;

// Sentinel probe: this define is only provided through the compilerArgs of the
// custom configuration provider used by the tests. The hover assertion proves
// that the provider's arguments (which also carry the GCC module flags) were
// delivered to the language server for this translation unit.
#ifdef PROVIDER_GCC_SENTINEL
int provider_gcc_sentinel_value = 1;
#endif

int probe_provider_gcc()
{
    return provider_gcc_sentinel_value;
}

int main()
{
    return add(2, 3) + square_area(4) - math::k_answer;
}
