int area(const int width, const int height)
{
    return width * height;
}

void swap(int &first, int &last, bool flag)
{}

void underscores(int ___x, int __y, int _z, int a)
{}

template <typename T>
T get();

void auto_type_templates()
{
    const auto x = get<int*>(); // : int *const
    const auto x1 = get<const int*>(); // : const int *const
    const auto& x2 = get<const int*>(); // : const int *const &
    auto * const x3 = get<const int*>(); // : const int *const
    const auto x4 = get<const int&>(); // : const int
    auto& x5 = get<const int&>(); // : const int &
    decltype(auto) x6 = get<const int&>(); // : const int &
    decltype(auto) x7 = get<const int*>(); // : const int *
    decltype(auto) x8 = get<int * const>(); // : int *
    decltype(auto) x9 = get<const int *>(); // : const int *

    // simple auto usage
    auto index = 1; // : int
    for (auto i = 0; i < 8; i++) // : int
    {}
}

void params_with_underscore()
{
    underscores(1, 2, 3, 4); // hide or show leading underscores
}

void param_names()
{
    // Displays all param name hints
    int a = area(5, 3);
    int a = area(5,
                 3);
    int a = area(
                 5,
                 3);

    // Displays param name for "height" only when suppressWhenArgumentContainsName is true
    int width = 5;
    a = area(width, 3);
    a = area(4 /*width*/, 3);
    a = area(   4 /*width*/, 3);
    a = area(4 /*width*/,
             3);
    a = area(
             4 /*width*/,
             3);

    // Displays param name for "width" only when suppressWhenArgumentContainsName is true
    int height = 3;
    a = area(5, height);
    a = area(5, 8 /*height*/);
    a = area(   5, 8 /*height*/);
    a = area(5,
             8 /*height*/);
    a = area(
             5,
             8 /*height*/);

    // No hints only when suppressWhenArgumentContainsName is true
    a = area(width, height);
    a = area(   width, height);
    a = area(width,
             height);
    a = area(
             width,
             height);
}

void param_and_reference_operator()
{
    int x = 1;
    int y = 2;
    bool ff = true;

    // Displays "&" operator and/or param name hints
    swap(x, y, ff);
    swap(x /*first*/, y, ff);
    swap(x /*first*/,
         y,
         ff);
    swap(
         x /*first*/,
         y,
         ff);

    swap(x, y, ff);
    swap(x, y /*last*/, ff);
    swap(x,
         y /*last*/,
         ff);
    swap(
         x,
         y /*last*/,
         ff);
}
