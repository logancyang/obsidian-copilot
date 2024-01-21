import React from 'react';
import { TextComponent } from './SettingBlocks';

const ApiSetting: React.FC<{
  title: string;
  description?: string;
  value: string;
  setValue: (value: string) => void;
  placeholder?: string;
  type?: string;
}> = ({ title, description, value, setValue, placeholder, type }) => {
  return (
    <div>
      <TextComponent
        name={title}
        description={description}
        value={value}
        // @ts-ignore
        onChange={setValue}
        placeholder={placeholder || ''}
        type={type || 'password'}
      />
    </div>
  );
};

export default ApiSetting;
