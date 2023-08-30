
#include <string>

// comment for myfunction
void myfunction(int var1, std::string var2, std::string var3)
{
}

// Verifies if input is even number or not
bool isEven(int value)
{
    return value % 2 == 0;
}

/// @brief Calculates area of rectangle
/// @tparam T is template param
/// @param base is horizontal length
/// @param height is vertical length
/// @return Area of rectangle
/// @exception This is an exception comment
/// @pre This is pre comment
template<typename T>
T testDoxygen(T base, T height)
{
    double result;
    result = base * height;
    return (T)result;
}

int main()
{
    std::string stringVar = "myString";
    int intVar = 0;
    myfunction(intVar, stringVar, "stringVar");
    myfunction(false);
    bool result = isEven(1);
    testDoxygen(2, 3);
}