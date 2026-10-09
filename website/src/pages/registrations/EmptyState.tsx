import { Link } from 'react-router-dom';
import { Box, Button, Stack, Text } from '@mantine/core';
import { IconArrowRight } from '@tabler/icons-react';
import { clubDesign } from '../../theme';

export function EmptyState({ isAdmin, scope }: { isAdmin: boolean; scope: 'personal' | 'club' }) {
  return (
    <Box
      p="xl"
      style={{
        background: clubDesign.color.n1,
        border: `1px dashed ${clubDesign.color.n3}`,
        borderRadius: clubDesign.radius.card,
        textAlign: 'center',
      }}
    >
      <Stack align="center" gap="sm">
        <Text fw={700} ff={clubDesign.font.heading}>
          {scope === 'club'
            ? 'No registrations yet for this club.'
            : 'No registrations linked to your account yet.'}
        </Text>
        {scope === 'personal' && !isAdmin && (
          <>
            <Text size="sm" c="dimmed" maw={460}>
              If you've registered with the club, our admins will link your account to your
              player record. In the meantime, you can register or renew below.
            </Text>
            <Button
              component={Link}
              to="/register"
              radius="xl"
              rightSection={<IconArrowRight size={14} />}
            >
              Register &amp; Pay
            </Button>
          </>
        )}
      </Stack>
    </Box>
  );
}
