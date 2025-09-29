#!/bin/bash

# Function to migrate a file from Vitest to Jest
migrate_file() {
  local file=$1
  echo "Migrating $file..."
  
  # Replace Vitest imports with Jest imports
  sed -i '' \
    -e 's/from .vitest./from '\''@jest\/globals'\''/g' \
    -e 's/import.*vi.*from .vitest./import { describe, it, expect, beforeEach, afterEach, jest } from '\''@jest\/globals'\''/g' \
    "$file"
  
  # Replace vi.* with jest.* calls
  sed -i '' \
    -e 's/vi\.fn()/jest.fn()/g' \
    -e 's/vi\.spyOn/jest.spyOn/g' \
    -e 's/vi\.mock/jest.mock/g' \
    -e 's/vi\.unmock/jest.unmock/g' \
    -e 's/vi\.clearAllMocks/jest.clearAllMocks/g' \
    -e 's/vi\.resetAllMocks/jest.resetAllMocks/g' \
    -e 's/vi\.restoreAllMocks/jest.restoreAllMocks/g' \
    -e 's/vi\.mockImplementation/jest.mockImplementation/g' \
    -e 's/vi\.mockResolvedValue/jest.mockResolvedValue/g' \
    -e 's/vi\.mockRejectedValue/jest.mockRejectedValue/g' \
    "$file"
}

# Find all test files
find . -type f -name "*.test.ts" -o -name "*.spec.ts" | while read -r file; do
  # Check if file contains Vitest imports or vi.* usage
  if grep -q 'from .vitest.' "$file" || grep -q 'vi\.' "$file"; then
    migrate_file "$file"
  fi
done

echo "Migration complete! Please review the changes and run tests to verify."