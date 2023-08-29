
#include <string>

// comment for myfunction
void myfunction(int var1, std::string var2, std::string var3)
{
}

int main()
{
    std::string stringVar = "myString";
    int intVar = 0;
    myfunction(intVar, stringVar, "stringVar");
    myfunction(intVar);
}