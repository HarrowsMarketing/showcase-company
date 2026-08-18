export const TEAM = [
  { initials: 'AC', name: 'Alex Chen',     email: 'alex',   fullEmail: 'alex@yourcompany.io',   color: 'bg-blue-500',   hexColor: '#3B82F6', textColor: 'text-blue-600',   borderColor: 'border-blue-400'   },
  { initials: 'MP', name: 'Morgan Patel',  email: 'morgan', fullEmail: 'morgan@yourcompany.io', color: 'bg-orange-500', hexColor: '#F97316', textColor: 'text-orange-600', borderColor: 'border-orange-400' },
  { initials: 'CD', name: 'Cara Diaz',     email: 'cara',   fullEmail: 'cara@yourcompany.io',   color: 'bg-green-500',  hexColor: '#22C55E', textColor: 'text-green-600',  borderColor: 'border-green-400'  },
  { initials: 'SK', name: 'Sam Kim',       email: 'sam',    fullEmail: 'sam@yourcompany.io',    color: 'bg-purple-500', hexColor: '#A855F7', textColor: 'text-purple-600', borderColor: 'border-purple-400' },
]

export type TeamMember = typeof TEAM[0]
