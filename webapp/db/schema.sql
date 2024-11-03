CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question TEXT NOT NULL,
    correct_answer TEXT NOT NULL,
    difficulty INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
    category TEXT NOT NULL
);

-- Insert some sample questions
INSERT INTO questions (question, correct_answer, difficulty, category) VALUES
    ('What is the name of Earth''s largest satellite?', 'Moon', 1, 'Astronomy'),
    ('What is the average distance between the Earth and the Sun?', '93 million miles', 2, 'Astronomy'),
    ('What is the name of the galaxy containing our solar system?', 'Milky Way', 2, 'Astronomy'),
    ('What is the process by which stars produce energy?', 'Nuclear fusion', 3, 'Astrophysics'),
    ('What is the name of NASA''s most famous space telescope?', 'Hubble Space Telescope', 2, 'Space Technology'),
    ('What should you do if you notice oxygen tanks are leaking during maintenance in a spacecraft?', 'Immediately report the issue, isolate the leak if possible, and prepare emergency oxygen supplies', 4, 'Mechanical Problem'),
    ('What are the steps for preparing to land on Mars?', 'Check systems, adjust trajectory, deploy heat shield, activate retro rockets, deploy parachutes, perform powered descent, touchdown', 5, 'Navigational Problem'),
    ('How do you prepare food in zero gravity?', 'Use specialized containers, secure utensils and ingredients, prepare in sealed areas, use hydration systems for liquids', 3, 'Resource Management');
