import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KanbanCard } from '../kanban-card';

describe('KanbanCard', () => {
  const mockIssue = {
    id: 'issue-1',
    key: 'DEMO-1',
    title: 'Test Issue',
    type: 'story',
    priority: 'high',
    assignee: {
      name: 'John Doe',
      avatar: 'https://avatar.vercel.sh/john',
    },
    labels: ['frontend', 'urgent'],
  };

  it('renders issue information correctly', () => {
    render(<KanbanCard issue={mockIssue} />);

    expect(screen.getByText('DEMO-1')).toBeInTheDocument();
    expect(screen.getByText('Test Issue')).toBeInTheDocument();
  });

  it('displays labels', () => {
    render(<KanbanCard issue={mockIssue} />);

    expect(screen.getByText('frontend')).toBeInTheDocument();
    expect(screen.getByText('urgent')).toBeInTheDocument();
  });

  it('shows assignee information', () => {
    render(<KanbanCard issue={mockIssue} />);

    expect(screen.getByText('John Doe')).toBeInTheDocument();
  });

  it('uses one keyboard-accessible card target for open and drag semantics', async () => {
    const user = userEvent.setup();
    const onClick = jest.fn();

    render(<KanbanCard issue={mockIssue} draggableId="issue-1" onClick={onClick} />);

    const card = screen.getByRole('button', { name: /Test Issue/i });
    expect(screen.getAllByRole('button')).toHaveLength(1);

    card.focus();
    await user.keyboard('{Enter}');

    expect(onClick).toHaveBeenCalledTimes(1);

    await user.keyboard(' ');

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
