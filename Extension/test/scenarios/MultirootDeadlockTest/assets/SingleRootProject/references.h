namespace nsReferences
{
    void funcInHeader1(); // referenced in source files references.cpp and main.cpp

    void funcInHeader2()
    {
        funcInHeader1();
    }

    void funcInHeader3();

    // func1 comment reference (header file)
}
