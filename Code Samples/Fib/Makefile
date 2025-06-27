CXX      := g++
CXXFLAGS := -std=c++11 -Wall -Wextra -pthread
LDFLAGS  := -pthread

SRCS     := main.cpp thread.cpp
OBJS     := $(SRCS:.cpp=.o)
TARGET   := fib_sample

all: $(TARGET)

$(TARGET): $(OBJS)
	$(CXX) $(OBJS) -o $@ $(LDFLAGS)

%.o: %.cpp
	$(CXX) $(CXXFLAGS) -c $< -o $@

clean:
	rm -f $(OBJS) $(TARGET)
