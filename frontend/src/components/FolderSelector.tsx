import React, { useState, useEffect } from 'react';

interface FolderSelectorProps {
  folders: string[];
  onFolderSelect: (folder: string) => void;
}

const FolderSelector: React.FC<FolderSelectorProps> = ({ folders, onFolderSelect }) => {
  const [inputValue, setInputValue] = useState("");
  const [filteredFolders, setFilteredFolders] = useState<string[]>(folders);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    if (inputValue === "") {
      setFilteredFolders(folders);
    } else {
      setFilteredFolders(
        folders.filter(folder =>
          folder.toLowerCase().includes(inputValue.toLowerCase())
        )
      );
    }
  }, [inputValue, folders]);

  const handleSelect = (folder: string) => {
    setInputValue("");
    onFolderSelect(folder);
    setShowDropdown(false);
  };

  return (
    // Center the component vertically and horizontally on the page.
    <div className="flex justify-center h-10vh">
      <div className="relative w-full max-w-lg">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => {setInputValue(e.target.value)}}
          onFocus={() => setShowDropdown(true)}
          onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
          placeholder="Search folders..."
          className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring focus:border-blue-300"
        />
        {showDropdown && (
          <ul className="absolute z-10 w-full bg-white border border-gray-300 mt-1 max-h-60 overflow-y-auto">
            {filteredFolders.map((folder, index) => (
              <li
                key={index}
                onClick={() => handleSelect(folder)}
                className="px-4 py-2 cursor-pointer hover:bg-gray-100 border-b last:border-0"
              >
                {folder}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default FolderSelector;
