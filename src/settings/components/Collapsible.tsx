import React, { ReactNode, useState } from 'react';

interface CollapsibleProps {
  title: ReactNode;
  children: ReactNode;
}

const Collapsible: React.FC<CollapsibleProps> = ({ title, children }) => {
  const [isOpen, setIsOpen] = useState(false);

  const titleStyle = {
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '10px',
    borderRadius: '5px',
  };

  const contentStyle = {
    padding: '10px 10px',
    borderRadius: '8px',
    marginTop: '10px',
  };

  const ChevronDown = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
  );

  const ChevronRight = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6"></polyline>
    </svg>
  );

  return (
    <div style={{ padding: '20px' }}>
      <div style={titleStyle} onClick={() => setIsOpen(!isOpen)}>
        {title}
        {isOpen ? <ChevronDown /> : <ChevronRight />}
      </div>
      {isOpen && (
        <div style={contentStyle}>
          {children}
        </div>
      )}
    </div>
  );
};

export default Collapsible;
