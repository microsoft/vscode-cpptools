/// @brief Calculates area of triangle
/// @tparam T is template param
/// @param base is horizontal length
/// @param height is vertical length
/// @return Area of triangle
/// @exception This is an exception comment
/// @deprecated This is deprecated comment
/// @note this is note
/// @attention this is attention
/// @pre this is pre comment
template<typename T>
T TriangleArea(T base, T height)
{
    double result;
    result = base * height * 0.5;
    return (T)result;
}

/// @brief Calculates area of rectangle
/// @tparam T is template param
/// @param base is horizontal length
/// @param height is vertical length
/// @return Area of rectangle
/// @exception This is an exception comment
template<typename T>
T RectangleArea(T base, T height)
{
    double result;
    result = base * height;
    return (T)result;
}

/// @brief function with no parameters and no returns
void func_zero()
{}

/// @brief function with one parameter and no returns
/// @param myParam is horizontal length
void func_one(int myParam)
{}

/// @brief function with two parameter and no returns
/// @param value_one is first parameter
/// @param value_two is second parameter
void func_two(int value_one, double value_two)
{}

/// @brief function with two parameters
/// @param value_one is first parameter
/// @param value_two is second parameter
/// @return 1 if value_one is greater than 0, otherwise 3.
int func_three(int value_one, double value_two)
{
    return (value_one > 0) ? 1 : 3;
}

int main()
{
    int area = TriangleArea(1, 2);

    func_three(8, 7);

    return 0;
}