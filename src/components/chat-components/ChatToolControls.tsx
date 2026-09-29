import React from "react";
import { Database, Globe, Pen, Sparkles, Brain, Wrench, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChainType } from "@/chainType";
import { cn } from "@/lib/utils";
import { updateSetting } from "@/settings/model";
import { isPlusChain } from "@/utils";

interface ChatToolControlsProps {
  vaultToggle: boolean;
  setVaultToggle: (value: boolean) => void;
  webToggle: boolean;
  setWebToggle: (value: boolean) => void;
  composerToggle: boolean;
  setComposerToggle: (value: boolean) => void;
  autonomousAgentToggle: boolean;
  setAutonomousAgentToggle: (value: boolean) => void;

  onVaultToggleOff?: () => void;
  onWebToggleOff?: () => void;
  onComposerToggleOff?: () => void;

  currentChain: ChainType;
}

const ChatToolControls: React.FC<ChatToolControlsProps> = ({
  vaultToggle,
  setVaultToggle,
  webToggle,
  setWebToggle,
  composerToggle,
  setComposerToggle,
  autonomousAgentToggle,
  setAutonomousAgentToggle,
  onVaultToggleOff,
  onWebToggleOff,
  onComposerToggleOff,
  currentChain,
}) => {
  const isCopilotPlus = isPlusChain(currentChain);
  const showAutonomousAgent = isCopilotPlus;

  const handleAutonomousAgentToggle = () => {
    const newValue = !autonomousAgentToggle;
    setAutonomousAgentToggle(newValue);
    updateSetting("enableAutonomousAgent", newValue);
  };

  const handleVaultToggle = () => {
    const newValue = !vaultToggle;
    setVaultToggle(newValue);
    if (!newValue && onVaultToggleOff) {
      onVaultToggleOff();
    }
  };

  const handleWebToggle = () => {
    const newValue = !webToggle;
    setWebToggle(newValue);
    if (!newValue && onWebToggleOff) {
      onWebToggleOff();
    }
  };

  const handleComposerToggle = () => {
    const newValue = !composerToggle;
    setComposerToggle(newValue);
    if (!newValue && onComposerToggleOff) {
      onComposerToggleOff();
    }
  };

  if (!isCopilotPlus) {
    return null;
  }

  return (
    <TooltipProvider delayDuration={0}>
      <div className="tw-hidden tw-items-center tw-gap-1.5 @[420px]/chat-input:tw-flex">
        {showAutonomousAgent && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost2"
                size="fit"
                onClick={handleAutonomousAgentToggle}
                className={cn(
                  "tw-text-muted hover:tw-text-accent",
                  autonomousAgentToggle && "tw-text-accent tw-bg-accent/10"
                )}
              >
                <Brain className="tw-size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="tw-px-1 tw-py-0.5">
              Toggle autonomous agent mode
            </TooltipContent>
          </Tooltip>
        )}

        {!autonomousAgentToggle && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost2"
                  size="fit"
                  onClick={handleVaultToggle}
                  className={cn(
                    "tw-text-muted hover:tw-text-accent",
                    vaultToggle && "tw-text-accent tw-bg-accent/10"
                  )}
                >
                  <Database className="tw-size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="tw-px-1 tw-py-0.5">Toggle vault search</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost2"
                  size="fit"
                  onClick={handleWebToggle}
                  className={cn(
                    "tw-text-muted hover:tw-text-accent",
                    webToggle && "tw-text-accent tw-bg-accent/10"
                  )}
                >
                  <Globe className="tw-size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="tw-px-1 tw-py-0.5">Toggle web search</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost2"
                  size="fit"
                  onClick={handleComposerToggle}
                  className={cn(
                    "tw-text-muted hover:tw-text-accent",
                    composerToggle && "tw-text-accent tw-bg-accent/10"
                  )}
                >
                  <span className="tw-flex tw-items-center tw-gap-0.5">
                    <Sparkles className="tw-size-2" />
                    <Pen className="tw-size-3" />
                  </span>
                </Button>
              </TooltipTrigger>
              <TooltipContent className="tw-px-1 tw-py-0.5">
                Toggle composer (note editing)
              </TooltipContent>
            </Tooltip>
          </>
        )}
      </div>

      <div className="tw-flex tw-items-center tw-gap-0.5 @[420px]/chat-input:tw-hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost2" size="fit" className="tw-text-muted hover:tw-text-accent">
              <Wrench className="tw-size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="tw-w-56">
            {showAutonomousAgent && (
              <DropdownMenuItem
                onClick={handleAutonomousAgentToggle}
                className="tw-flex tw-items-center tw-justify-between"
              >
                <div className="tw-flex tw-items-center tw-gap-2">
                  <Brain className="tw-size-4" />
                  <span>Autonomous Agent</span>
                </div>
                {autonomousAgentToggle && <Check className="tw-size-4" />}
              </DropdownMenuItem>
            )}

            {!autonomousAgentToggle && (
              <>
                <DropdownMenuItem
                  onClick={handleVaultToggle}
                  className="tw-flex tw-items-center tw-justify-between"
                >
                  <div className="tw-flex tw-items-center tw-gap-2">
                    <Database className="tw-size-4" />
                    <span>Vault Search</span>
                  </div>
                  {vaultToggle && <Check className="tw-size-4" />}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleWebToggle}
                  className="tw-flex tw-items-center tw-justify-between"
                >
                  <div className="tw-flex tw-items-center tw-gap-2">
                    <Globe className="tw-size-4" />
                    <span>Web Search</span>
                  </div>
                  {webToggle && <Check className="tw-size-4" />}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleComposerToggle}
                  className="tw-flex tw-items-center tw-justify-between"
                >
                  <div className="tw-flex tw-items-center tw-gap-2">
                    <span className="tw-flex tw-items-center tw-gap-0.5">
                      <Sparkles className="tw-size-2" />
                      <Pen className="tw-size-3" />
                    </span>
                    <span>Composer</span>
                  </div>
                  {composerToggle && <Check className="tw-size-4" />}
                </DropdownMenuItem>
              </>
            )}

            {autonomousAgentToggle && (
              <>
                <DropdownMenuItem
                  disabled
                  className="tw-flex tw-items-center tw-justify-between tw-opacity-50"
                >
                  <div className="tw-flex tw-items-center tw-gap-2">
                    <Database className="tw-size-4" />
                    <span>Vault Search</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled
                  className="tw-flex tw-items-center tw-justify-between tw-opacity-50"
                >
                  <div className="tw-flex tw-items-center tw-gap-2">
                    <Globe className="tw-size-4" />
                    <span>Web Search</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled
                  className="tw-flex tw-items-center tw-justify-between tw-opacity-50"
                >
                  <div className="tw-flex tw-items-center tw-gap-2">
                    <span className="tw-flex tw-items-center tw-gap-0.5">
                      <Sparkles className="tw-size-2" />
                      <Pen className="tw-size-3" />
                    </span>
                    <span>Composer</span>
                  </div>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </TooltipProvider>
  );
};

export { ChatToolControls };
