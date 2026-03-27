"use client";

import { useMemo, useState } from "react";

import type { AgentOption } from "@/lib/referrals";

type AgentSearchFieldProps = {
  agents: AgentOption[];
  defaultAgentId?: string | null;
  label?: string;
  inputName?: string;
  helperText?: string;
};

export default function AgentSearchField({
  agents,
  defaultAgentId = null,
  label = "Preferred Agent to Handle LEAD",
  inputName = "preferredAgentId",
  helperText = "Select an agent from the search results.",
}: AgentSearchFieldProps) {
  const defaultAgent = useMemo(
    () => (defaultAgentId ? agents.find((agent) => agent.id === defaultAgentId) : undefined),
    [agents, defaultAgentId],
  );
  const [query, setQuery] = useState(defaultAgent?.name ?? "");
  const [selectedAgentId, setSelectedAgentId] = useState(defaultAgent?.id ?? "");
  const [isOpen, setIsOpen] = useState(false);

  const filteredAgents = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return agents.slice(0, 12);
    }

    return agents
      .filter((agent) => agent.name.toLowerCase().includes(keyword))
      .slice(0, 12);
  }, [agents, query]);

  return (
    <label className="text-sm text-slate-700 md:col-span-2">
      {label}
      <input type="hidden" name={inputName} value={selectedAgentId} />
      <input
        type="search"
        value={query}
        onFocus={() => setIsOpen(true)}
        onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
        onChange={(event) => {
          setQuery(event.target.value);
          setSelectedAgentId("");
          setIsOpen(true);
        }}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-amber-500 focus:ring"
        placeholder="Search by agent name"
        autoComplete="off"
      />
      {isOpen && filteredAgents.length > 0 ? (
        <div className="relative">
          <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-300 bg-white p-1 shadow-lg">
            {filteredAgents.map((agent) => (
              <li key={agent.id}>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setQuery(agent.name);
                    setSelectedAgentId(agent.id);
                    setIsOpen(false);
                  }}
                  className="block w-full rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                >
                  {agent.name}
                  <span className="ml-2 text-xs text-slate-500">ID: {agent.id}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="mt-1 text-xs text-slate-500">
        {selectedAgentId ? `Selected agent ID: ${selectedAgentId}` : helperText}
      </p>
    </label>
  );
}
