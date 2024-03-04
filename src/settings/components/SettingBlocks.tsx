import React from 'react';

type DropdownComponentProps = {
  name: string;
  description?: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
};

type TextComponentProps = {
  name: string;
  description?: string;
  placeholder: string;
  value: string;
  type?: string;
  onChange: (value: string) => void;
};

type TextAreaComponentProps = {
  name: string;
  description?: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
};

type SliderComponentProps = {
  name: string;
  description?: React.ReactNode; // This allows for JSX elements, strings, etc.
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
};

type ToggleComponentProps = {
  name: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}

const DropdownComponent: React.FC<DropdownComponentProps> = ({ name, description, options, value, onChange }) => {
  return (
    <div className="copilot-setting-item">
      <div className="copilot-setting-item-name">{name}</div>
      <div className="copilot-setting-item-description">{description}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="copilot-setting-item-control"
      >
        {options.map((option, index) => (
          <option key={index} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
};

const TextComponent: React.FC<TextComponentProps> = ({ name, description, placeholder, value, type, onChange }) => {
  return (
    <div className="copilot-setting-item">
      <div className="copilot-setting-item-name">{name}</div>
      <div className="copilot-setting-item-description">{description}</div>
      <input
        type={type || 'text'}
        className="copilot-setting-item-control"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
};

const TextAreaComponent: React.FC<TextAreaComponentProps> = ({ name, description, placeholder, value, onChange }) => {
  return (
    <div className="copilot-setting-item">
      <div className="copilot-setting-item-name">{name}</div>
      <div className="copilot-setting-item-description">{description}</div>
      <textarea
        className="copilot-setting-item-control"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
};


const SliderComponent: React.FC<SliderComponentProps> = ({ name, description, min, max, step, value, onChange }) => {
  return (
    <div className="copilot-setting-item">
      <div className="copilot-setting-item-name">{name}</div>
      <div className="copilot-setting-item-description">{description}</div>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <input
          type="range"
          className="copilot-setting-item-control"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
        <span style={{ marginLeft: '20px', fontWeight: 'bold', color: 'var(--inline-title-color)' }}>{value}</span>
      </div>
    </div>
  );
};

const ToggleComponent: React.FC<ToggleComponentProps> = ({ name, description, value, onChange }) => {
  return (
    <div className="copilot-setting-item">
      <div className="copilot-setting-item-name">{name}</div>
      <div className="copilot-setting-item-description">{description}</div>
      <label className="switch">
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="slider round"></span>
      </label>
    </div>
  );
};

export { DropdownComponent, SliderComponent, TextAreaComponent, TextComponent, ToggleComponent };

