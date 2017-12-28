install(DIRECTORY "${PROJECT_SOURCE_DIR}/vscode-cpp/" 
    DESTINATION .
    PATTERN "CMakeLists*" EXCLUDE
    PATTERN "node_modules/*" EXCLUDE
    )


# Install the cpp.hint file used by VS. Note that we don't want to check this
# in to the vscode part of the branch because we don't want to maintain a copy.
install(FILES "${PROJECT_SOURCE_DIR}/../pkg/src/cpp.hint"
        DESTINATION .
)
